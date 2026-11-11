import type { Course, Subject } from "./soc";

const MAX_RESULTS = 60;
/** Title words only count from this length, so "cs" doesn't match every title with a "cs…" word. */
const MIN_TITLE_WORD = 3;

const squeeze = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const SKIP = new Set(["and", "of", "the", "in", "for"]);
const initials = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SKIP.has(w))
    .map((w) => w[0])
    .join("");

/** A course with its search keys worked out once. */
export type Entry = {
  course: Course;
  subjectName: string;
  /** Catalogue number in lower case, and without its letter prefix ("m51a" and "51a"). */
  number: string;
  bare: string;
  words: string[];
};

type SubjectKeys = { code: string; name: string; initials: string[]; words: string[] };

export type Index = { entries: Entry[]; subjects: Map<string, SubjectKeys> };

export function buildIndex(subjects: Subject[], courses: Course[]): Index {
  const names = new Map(subjects.map((s) => [s.code, s.name]));
  return {
    subjects: new Map(
      subjects.map((s) => [
        s.code,
        {
          code: squeeze(s.code),
          name: squeeze(s.name),
          initials: [initials(s.code), initials(s.name)],
          words: s.name.toLowerCase().split(/\s+/),
        },
      ]),
    ),
    entries: courses.map((course) => {
      const number = course.number.toLowerCase();
      return {
        course,
        subjectName: names.get(course.subject) ?? "",
        number,
        bare: number.replace(/^[a-z]+(?=\d)/, ""),
        words: course.title.toLowerCase().split(/[^a-z0-9]+/),
      };
    }),
  };
}

/** How well a subject matches typed text; 0 is no match. "cs", "com sci" and "ls" (Life Sciences) all work. */
function subjectScore(s: SubjectKeys, q: string): number {
  if (s.code === q) return 100;
  if (s.initials.includes(q)) return 90;
  if (s.code.startsWith(q)) return 80;
  if (s.name.startsWith(q)) return 70;
  if (s.words.some((w) => w.startsWith(q))) return 50;
  if (q.length > 2 && s.name.includes(q)) return 40;
  return 0;
}

/** How well a course matches the words left after the subject; 0 if any word doesn't fit. */
function courseScore(e: Entry, words: string[]): number {
  let total = 0;
  for (const w of words) {
    if (e.number === w) total += 60;
    else if (e.bare === w) total += 55;
    else if (/^\d/.test(w) && (e.number.startsWith(w) || e.bare.startsWith(w))) total += 30;
    else if (w.length >= MIN_TITLE_WORD && e.words.some((t) => t.startsWith(w))) total += 10;
    else return 0;
  }
  return total;
}

/** Splits "ls7a" into "ls" and "7a", so a subject and number typed together still work. */
const splitWord = (w: string) => w.match(/^([a-z&]+)(\d.*)$/)?.slice(1) ?? [w];

/**
 * Best score of a course for one reading of the query. The first k words name the subject and
 * the rest name the course; k = 0 searches every subject by number or title alone ("7a").
 */
function score(e: Entry, words: string[], subjectScores: Map<string, number>[]): number {
  let best = 0;
  for (let k = 0; k <= words.length; k++) {
    const subject = k === 0 ? 0 : (subjectScores[k].get(e.course.subject) ?? 0);
    if (k > 0 && !subject) continue;
    const rest = words.slice(k);
    const course = courseScore(e, rest);
    if (rest.length && !course) continue;
    best = Math.max(best, subject * 10 + course);
  }
  return best;
}

/** Courses matching a free-text query like "cs 31", "ls7a", "7a" or "physics mech", best first. */
export function search(index: Index, text: string): Entry[] {
  const typed = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!typed.length) return [];
  const readings = [typed, typed.flatMap(splitWord)];
  const scored = new Map<Entry, number>();
  for (const words of readings) {
    // subjectScores[k] rates every subject against the first k words joined.
    const subjectScores = Array.from({ length: words.length + 1 }, () => new Map<string, number>());
    for (let k = 1; k <= words.length; k++) {
      const q = squeeze(words.slice(0, k).join(""));
      if (!q) continue;
      for (const [code, keys] of index.subjects) {
        const n = subjectScore(keys, q);
        if (n) subjectScores[k].set(code, n);
      }
    }
    for (const e of index.entries) {
      const n = score(e, words, subjectScores);
      if (n > (scored.get(e) ?? 0)) scored.set(e, n);
    }
  }
  return [...scored.entries()]
    .sort(
      ([a, x], [b, y]) =>
        y - x ||
        a.course.subject.localeCompare(b.course.subject) ||
        a.course.catalog.localeCompare(b.course.catalog),
    )
    .slice(0, MAX_RESULTS)
    .map(([e]) => e);
}
