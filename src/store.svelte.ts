import { firefoxSession, login, socLoad, socLoadMany } from "./api";
import { addItem, extendSession, loadPlanner, removeItem, type PlanItem, type Planner } from "./myucla";
import { buildIndex, type Index } from "./search";
import { courseKey, parseCourses, parseListings, parseSubjects, parseTerms, paths, type Section, type Term } from "./soc";

export type Plan = {
  id: number;
  name: string;
  term: string;
  classes: Section[];
  /** Mirror this plan to and from the Class Planner on MyUCLA. One plan per term at most. */
  sync: boolean;
  /** Classes both sides had after the last sync, as group keys. Tells an addition from a removal. */
  synced: string[];
};

export type Settings = {
  /** Show "Lec 1" / "Dis 1A" on calendar boxes. */
  showLabels: boolean;
  showEnrolled: boolean;
  showLocation: boolean;
  /** Minutes between calendar lines: 60, 30 or 10. */
  lineMinutes: number;
  sidebarWidth: number;
  settingsOpen: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  showLabels: true,
  showEnrolled: false,
  showLocation: false,
  lineMinutes: 30,
  sidebarWidth: 380,
  settingsOpen: true,
};

type Saved = {
  /** Display settings. Earlier versions saved these as `settings`, with other defaults. */
  display: Settings;
  plans: Plan[];
  active: Record<string, number>;
  term?: string;
  /** Enrolled classes per term as last read from MyUCLA, shown while the slow planner page loads. */
  enrolled: Record<string, Section[]>;
};

const KEY = "plans-v2";
const parsed: Partial<Saved> = JSON.parse(localStorage.getItem(KEY) ?? "{}");
const saved: Saved = {
  plans: [],
  active: {},
  enrolled: {},
  ...parsed,
  display: { ...DEFAULT_SETTINGS, ...parsed.display },
};

export const store = $state({
  terms: [] as Term[],
  term: saved.term,
  settings: saved.display,
  /** Whether there is a plan change to undo. */
  canUndo: false,
  /** Every course of the term, for search. undefined while the first load runs. */
  index: undefined as Index | undefined,
  plans: saved.plans,
  /** Active plan id per term. */
  active: saved.active,
  /** Section under the mouse in search results, drawn on the calendar as a preview. */
  preview: undefined as Section | undefined,
  /** Lectures whose every discussion is drawn on the calendar, by lecture id. */
  options: {} as Record<string, Section[]>,
  /** undefined until the first MyUCLA request has answered. */
  signedIn: undefined as boolean | undefined,
  /** Enrolled classes per term. */
  enrolled: saved.enrolled,
  syncing: false,
  error: "",
});

function fail(e: unknown): void {
  store.error = String(e);
}

function persist(): void {
  const state: Saved = {
    display: store.settings,
    plans: store.plans,
    active: store.active,
    term: store.term,
    enrolled: store.enrolled,
  };
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function saveSettings(): void {
  persist();
}

// ---- Plans ----

export function termPlans(): Plan[] {
  return store.plans.filter((p) => p.term === store.term);
}

export function activePlan(): Plan | undefined {
  return store.plans.find((p) => p.id === store.active[store.term!]);
}

export function addPlan(): void {
  const term = store.term!;
  const id = Math.max(0, ...store.plans.map((p) => p.id)) + 1;
  store.plans.push({ id, name: `Plan ${termPlans().length + 1}`, term, classes: [], sync: false, synced: [] });
  store.active[term] = id;
  persist();
}

export function selectPlan(id: number): void {
  store.active[store.term!] = id;
  persist();
}

export function renamePlan(id: number, name: string): void {
  const plan = store.plans.find((p) => p.id === id)!;
  plan.name = name.trim() || plan.name;
  persist();
}

export function deletePlan(id: number): void {
  store.plans = store.plans.filter((p) => p.id !== id);
  const left = termPlans();
  if (left.length) store.active[store.term!] = left[0].id;
  else addPlan();
  persist();
}

// ---- Undo ----

const UNDO_LIMIT = 50;

/** Classes of a plan before each change, newest last. */
const history: { planId: number; classes: Section[] }[] = [];

function remember(plan: Plan): void {
  history.push({ planId: plan.id, classes: $state.snapshot(plan.classes) });
  if (history.length > UNDO_LIMIT) history.shift();
  store.canUndo = true;
}

/** Puts back the classes from before the last change. Sync then copies that to MyUCLA as a normal change. */
export function undo(): void {
  const last = history.pop();
  store.canUndo = history.length > 0;
  if (!last) return;
  const plan = store.plans.find((p) => p.id === last.planId);
  // The plan was deleted since; skip to the change before.
  if (!plan) return undo();
  plan.classes = last.classes;
  persist();
  if (plan.sync) queueSync();
}

export function isPlanned(id: string): boolean {
  return !!activePlan()?.classes.some((c) => c.id === id);
}

/**
 * Adds a section to the active plan, or removes it if it's already there.
 * A plan holds one lecture per course and one discussion per lecture, so picking another
 * replaces the old one. A discussion brings its lecture along; removing a lecture removes its
 * discussions. Picking a discussion also closes the all-discussions view of its lecture.
 */
export function toggle(section: Section, lecture?: Section): void {
  const plan = activePlan()!;
  remember(plan);
  if (isPlanned(section.id)) {
    plan.classes = plan.classes.filter((c) => c.id !== section.id && c.parent !== section.id);
  } else {
    const lec = lecture ?? section;
    plan.classes = plan.classes.filter((c) => courseKey(c) !== courseKey(lec) || c.id === lec.id);
    if (!isPlanned(lec.id)) plan.classes.push(lec);
    if (lecture) {
      plan.classes.push(section);
      delete store.options[lecture.id];
    }
  }
  persist();
  if (plan.sync) queueSync();
}

/** Removes every section of a course from the active plan. */
export function removeCourse(key: string): void {
  const plan = activePlan()!;
  remember(plan);
  plan.classes = plan.classes.filter((c) => courseKey(c) !== key);
  persist();
  if (plan.sync) queueSync();
}

/** Shows or hides every discussion of a lecture on the calendar, to compare them at a glance. */
export function toggleOptions(lecture: Section): void {
  if (store.options[lecture.id]) {
    delete store.options[lecture.id];
    return;
  }
  const term = store.term!;
  socLoad(`sections-${term}-${lecture.id}`, paths.children(term, lecture), (body) => {
    store.options[lecture.id] = parseListings(body, lecture, lecture);
  }).catch(fail);
}

// ---- Terms and the course index ----

export function selectTerm(code: string): void {
  store.term = code;
  store.index = undefined;
  store.options = {};
  if (!termPlans().length) addPlan();
  persist();
  loadIndex(code).catch(fail);
  refreshPlanner().catch(fail);
}

/** Loads every subject's course list for the term. Cached on disk, so only the first run waits. */
async function loadIndex(term: string): Promise<void> {
  await socLoad(`subjects-${term}`, paths.subjects(term), (body) => {
    const subjects = parseSubjects(body);
    const requests = Object.fromEntries(subjects.map((s) => [s.code, paths.courses(term, s.code)]));
    socLoadMany(`index-${term}`, requests, (bodies) => {
      if (store.term !== term) return;
      const courses = subjects.flatMap((s) => parseCourses(bodies[s.code] ?? "", s.code));
      store.index = buildIndex(subjects, courses);
    }).catch(fail);
  });
}

// ---- MyUCLA session ----

const KEEP_ALIVE_MS = 5 * 60 * 1000;

/** The planner page for the current term, kept for its form state. */
let planner: Planner | undefined;

/** Runs a MyUCLA request. If the session has ended, takes over Firefox's and tries once more. */
async function withSession<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (e) {
    if (e !== "unauthorized") throw e;
    await firefoxSession();
    return request();
  }
}

/** Reads enrolled classes and the UCLA plan for the current term, then syncs. */
async function refreshPlanner(): Promise<void> {
  const term = store.term;
  if (!term) return;
  try {
    planner = await withSession(() => loadPlanner(term));
  } catch (e) {
    if (e !== "unauthorized") throw e;
    store.signedIn = false;
    return;
  }
  store.signedIn = true;
  store.enrolled[term] = planner?.enrolled ?? [];
  persist();
  queueSync();
}

async function keepAlive(): Promise<void> {
  if (!store.signedIn) return;
  try {
    await withSession(extendSession);
  } catch (e) {
    if (e !== "unauthorized") throw e;
    store.signedIn = false;
  }
}

export function useFirefox(): void {
  firefoxSession()
    .then(refreshPlanner)
    .catch((e) => fail(e === "unauthorized" ? "Firefox is not signed in to MyUCLA." : e));
}

export function connect(): void {
  login().then(refreshPlanner).catch(fail);
}

// ---- Sync with the UCLA plan ----

/** A lecture with its discussions, the unit the UCLA plan adds and removes. Lecture first. */
type Group = Section[];

/** Identifies a group: its lecture, then its discussions in a fixed order. */
const groupKey = (g: Group) => [g[0].id, ...g.slice(1).map((s) => s.id).sort()].join("+");
const lectureOfKey = (key: string) => key.split("+")[0];
const describe = (g: Group) => `${g[0].subject} ${g[0].number} ${g[0].label}`;

function groups(classes: Section[]): Group[] {
  return classes.filter((c) => !c.parent).map((lec) => [lec, ...classes.filter((c) => c.parent === lec.id)]);
}

/** Puts a lecture's sections in the plan where that lecture was, or at the end. Empty removes it. */
function replaceGroup(plan: Plan, lectureId: string, sections: Section[]): void {
  const at = plan.classes.findIndex((c) => c.id === lectureId || c.parent === lectureId);
  const rest = plan.classes.filter((c) => c.id !== lectureId && c.parent !== lectureId);
  rest.splice(at === -1 ? rest.length : at, 0, ...sections);
  plan.classes = rest;
}

async function removeRemote(item: PlanItem): Promise<void> {
  planner = await removeItem(planner!, item);
  if (planner.items.some((i) => i.removeCommand === item.removeCommand)) {
    throw new Error(`MyUCLA did not remove ${describe(item.sections)} from your plan.`);
  }
}

async function addRemote(group: Group): Promise<void> {
  planner = await addItem(planner!, group);
  if (!planner.items.some((i) => groupKey(i.sections) === groupKey(group))) {
    throw new Error(`MyUCLA did not add ${describe(group)} to your plan.`);
  }
}

export function setSync(plan: Plan, on: boolean): void {
  // The UCLA planner holds one plan per term, so only one local plan can mirror it.
  if (on) for (const p of store.plans) if (p.term === plan.term) p.sync = false;
  plan.sync = on;
  plan.synced = [];
  persist();
  if (on) queueSync();
}

/**
 * Two-way sync of the term's synced plan, matched by lecture. A lecture on one side only is new
 * there if the last sync didn't have it, and gets copied across; if the last sync did have it,
 * the other side removed it, and it's removed here too. When both sides have a lecture with
 * different discussions, the side that changed since the last sync wins, the app if both did.
 * A lecture listed twice on MyUCLA is cut down to one.
 */
async function sync(): Promise<void> {
  const plan = store.plans.find((p) => p.term === store.term && p.sync);
  if (!plan || !planner || planner.term !== plan.term) return;
  const known = new Set(plan.synced);
  const knownLectures = new Set(plan.synced.map(lectureOfKey));
  const local = new Map(groups(plan.classes).map((g) => [g[0].id, g]));

  // One MyUCLA class per lecture: keep the copy that matches the app, else the first.
  const remote = new Map<string, PlanItem>();
  const extras: PlanItem[] = [];
  for (const item of planner.items) {
    const id = item.sections[0].id;
    const kept = remote.get(id);
    if (!kept) remote.set(id, item);
    else if (local.has(id) && groupKey(item.sections) === groupKey(local.get(id)!)) {
      extras.push(kept);
      remote.set(id, item);
    } else extras.push(item);
  }
  for (const item of extras) await removeRemote(item);

  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const mine = local.get(id);
    const theirs = remote.get(id);
    if (mine && theirs) {
      if (groupKey(mine) === groupKey(theirs.sections)) continue;
      if (known.has(groupKey(mine))) {
        replaceGroup(plan, id, theirs.sections);
      } else {
        await removeRemote(theirs);
        await addRemote(mine);
      }
    } else if (theirs) {
      if (knownLectures.has(id)) await removeRemote(theirs);
      else replaceGroup(plan, id, theirs.sections);
    } else if (mine) {
      if (knownLectures.has(id)) replaceGroup(plan, id, []);
      else await addRemote(mine);
    }
  }

  plan.synced = groups(plan.classes).map(groupKey);
  persist();
}

// Syncs run one after another: each postback needs the form state the previous one returned.
let queue = Promise.resolve();

function queueSync(): void {
  queue = queue.then(async () => {
    store.syncing = true;
    try {
      await sync();
    } catch (e) {
      // Session ended mid-sync: reload the page with a fresh session, which syncs again.
      if (e === "unauthorized") await refreshPlanner().catch(fail);
      else fail(e);
    }
    store.syncing = false;
  });
}

// ---- Startup ----

export function start(): void {
  setInterval(() => keepAlive().catch(fail), KEEP_ALIVE_MS);
  // The page arrives twice (cached, then fresh); the term only needs choosing once.
  let chosen = false;
  socLoad("home", paths.home, (body) => {
    const { terms, current } = parseTerms(body);
    store.terms = terms;
    if (chosen) return;
    chosen = true;
    selectTerm(store.term ?? current);
  }).catch(fail);
}
