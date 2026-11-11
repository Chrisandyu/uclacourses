/** The MyUCLA Class Planner (be.my.ucla.edu), an ASP.NET WebForms page driven by form postbacks. */
import { myuclaGet, myuclaPost } from "./api";
import { instructors, lines, parseMeetings, type Section } from "./soc";

const PLANNER = "/ClassPlanner/ClassPlan.aspx";
const EXTEND = "/IWE/Timeout.aspx/Extend";
const TERM_FIELD = "ctl00$MainContent$termSessionChooser$TermChooser";
const ADD_FIELD = "ctl00$MainContent$cs$selectedClass";
const PLAN_COMMAND = "ctl00$MainContent$planClassListView$clCommandField";
const PLAN_COMMAND_TRACKER = "ctl00$MainContent$planClassListView$clCommandFieldTracker";

/** One class in the UCLA plan: a lecture with its discussions, removed as a unit. */
export type PlanItem = { removeCommand: string; sections: Section[] };

export type Planner = {
  term: string;
  /** Terms the planner can switch to. */
  terms: string[];
  /** The page's form state, sent back with every postback. */
  fields: [string, string][];
  enrolled: Section[];
  items: PlanItem[];
};

function parseSections(course: Element): Section[] {
  const heading = course.querySelectorAll(".SubjectAreaName_ClassName p")[1].textContent!.trim();
  const split = heading.indexOf(" - ");
  const out: Section[] = [];
  for (const row of course.querySelectorAll('tr[id$="_thisRow"]')) {
    const link = row.querySelector<HTMLAnchorElement>(".section-header a")!;
    const params = new URL(link.href).searchParams;
    const cells = row.querySelectorAll("td");
    const days = lines(cells[4]);
    const times = lines(cells[5]);
    out.push({
      id: params.get("class_id")!,
      subject: params.get("subj_area_cd")!.trim(),
      catalog: params.get("crs_catlg_no")!.trimEnd(),
      classNo: params.get("class_no")!,
      number: heading.slice(0, split),
      title: heading.slice(split + 3),
      label: link.textContent!.trim(),
      days: days.join(", "),
      time: times.join(", "),
      location: lines(cells[6]).join(", "),
      units: cells[7].textContent!.trim(),
      instructor: instructors(lines(cells[8])),
      meetings: parseMeetings(days, times),
      // Rows after the first are the lecture's discussions and labs.
      parent: out[0]?.id,
    });
  }
  return out;
}

function parse(body: string): Planner {
  const doc = new DOMParser().parseFromString(body, "text/html");
  const form = doc.querySelector<HTMLFormElement>("form#aspnetForm");
  if (!form) throw new Error("MyUCLA: the Class Planner page has no form");
  const fields = [...new FormData(form).entries()].map(([k, v]) => [k, String(v)] as [string, string]);
  const chooser = form.querySelector<HTMLSelectElement>(`select[name="${TERM_FIELD}"]`)!;
  return {
    term: chooser.value,
    terms: [...chooser.options].map((o) => o.value),
    fields,
    enrolled: [...doc.querySelectorAll("tbody.itemEnrolled")].flatMap(parseSections),
    items: [...doc.querySelectorAll("tbody.itemClass")].map((course) => ({
      removeCommand: course.innerHTML.match(/Remove Class From Plan\|[^'"]*/)![0],
      sections: parseSections(course),
    })),
  };
}

/** Submits the planner's form with some fields changed, as its own scripts do, and reads the new page. */
async function postback(page: Planner, changes: Record<string, string>): Promise<Planner> {
  const body = new URLSearchParams(page.fields.filter(([k]) => !(k in changes)));
  for (const [k, v] of Object.entries(changes)) body.append(k, v);
  return parse(await myuclaPost(PLANNER, body.toString(), "application/x-www-form-urlencoded"));
}

/** The planner page for a term, or undefined if the planner doesn't offer that term. */
export async function loadPlanner(term: string): Promise<Planner | undefined> {
  const page = parse(await myuclaGet(PLANNER));
  if (page.term === term) return page;
  if (!page.terms.includes(term)) return undefined;
  return postback(page, { __EVENTTARGET: TERM_FIELD, [TERM_FIELD]: term });
}

/**
 * Runs a plan change and returns the planner as it is afterwards. MyUCLA's reply to a change
 * can still show the plan from before it (always for removals), so the page is loaded again.
 */
async function change(page: Planner, changes: Record<string, string>): Promise<Planner> {
  await postback(page, changes);
  const fresh = await loadPlanner(page.term);
  if (!fresh) throw new Error(`MyUCLA no longer offers ${page.term} in the Class Planner`);
  return fresh;
}

/** The registrar's section number for a label: "Lec 1" is " 001  ", "Dis 1A" is " 001A ". */
function sectionNumber(label: string): string {
  const m = label.match(/(\d+)([A-Z]*)$/);
  if (!m) throw new Error(`Unreadable section "${label}"`);
  return ` ${m[1].padStart(3, "0")}${m[2]}`.padEnd(6);
}

/** Adds a lecture with its discussions to the UCLA plan as a new class. */
export function addItem(page: Planner, sections: Section[]): Promise<Planner> {
  const [lec] = sections;
  const value = [
    lec.subject.padEnd(7),
    lec.catalog.padEnd(8),
    lec.classNo,
    sections.map((s) => sectionNumber(s.label)).join(","),
    `course_M0_${sections.map((s) => s.id).join("_")}`,
    // 0 adds a new class instead of replacing one already in the plan.
    "0",
  ].join("$");
  return change(page, { __EVENTTARGET: "selectedClass", [ADD_FIELD]: value });
}

export function removeItem(page: Planner, item: PlanItem): Promise<Planner> {
  return change(page, {
    __EVENTTARGET: "ctl00_main_wrapper",
    __EVENTARGUMENT: item.removeCommand,
    [PLAN_COMMAND]: item.removeCommand,
    [PLAN_COMMAND_TRACKER]: "1",
  });
}

/** Resets MyUCLA's 15-minute inactivity timer, like the site's "Extend" button. */
export async function extendSession(): Promise<void> {
  await myuclaPost(EXTEND, "{}", "application/json; charset=utf-8");
}
