/** Parsers for UCLA's public Schedule of Classes (sa.ucla.edu/ro/public/soc). */

export type Term = { code: string; name: string };
export type Subject = { code: string; name: string };

export type Course = {
  subject: string;
  /** Catalogue number as the registrar stores it, e.g. "0031" or "0051A M". */
  catalog: string;
  /** "%" for every class of the course, or one class number for topic courses like COM SCI 188. */
  classNo: string;
  /** Catalogue number as shown to students, e.g. "31" or "M51A". */
  number: string;
  title: string;
};

/** One weekly meeting. Days are 1 (Monday) to 7 (Sunday); times are minutes from midnight. */
export type Meeting = { days: number[]; start: number; end: number };

/** A lecture, discussion or lab, as saved in plans and drawn on the calendar. */
export type Section = {
  id: string;
  subject: string;
  catalog: string;
  /** The registrar's class number, e.g. " 001  ". Shared by a lecture and its discussions. */
  classNo: string;
  number: string;
  title: string;
  /** e.g. "Lec 1" or "Dis 1A". */
  label: string;
  days: string;
  time: string;
  location: string;
  instructor: string;
  units: string;
  meetings: Meeting[];
  /** The lecture this discussion or lab belongs to. */
  parent?: string;
};

/** Identifies a course across sections, e.g. "MATH 32B". */
export const courseKey = (s: Section) => `${s.subject} ${s.number}`;

/** "Ko, J." for one instructor, "Ko, J. …" when there are more. */
export const instructors = (names: string[]) => (names.length > 1 ? `${names[0]} …` : (names[0] ?? ""));

/** "12pm-1:50pm" as "12-1:50 PM". Only the end time keeps its am/pm. */
export const formatTime = (time: string) =>
  time.replace(/(\d{1,2}(?::\d{2})?)(?:am|pm)-(\d{1,2}(?::\d{2})?)(am|pm)/g, (_, a, b, m) => `${a}-${b} ${m.toUpperCase()}`);

/** Enrolment status as shown in lists: "Closed by Department of …" reads "Closed by dept." */
export const formatStatus = (status: string) => (/^closed by dep/i.test(status) ? "Closed by dept." : status);

/** A section in search results, with its live enrolment state. */
export type Listing = Section & {
  /** e.g. "Open", "Closed", "Waitlist". */
  status: string;
  /** e.g. "206 Spots Left". */
  seats: string;
};

const SEARCH_DATA = "/ro/ClassSearch/Public/Search/GetLevelSeparatedSearchData";
const SUMMARY = "/ro/public/soc/Results/GetCourseSummary";
// The summary endpoint returns nothing without filter flags; these ask for every enrolment status.
const FILTER_FLAGS = JSON.stringify({ enrollment_status: "O,W,C,X,T,S", advanced: "y" });

const query = (params: Record<string, string>) => "?" + new URLSearchParams(params);

const sections = (model: object) => SUMMARY + query({ model: JSON.stringify(model), FilterFlags: FILTER_FLAGS });

/** Request model for the summary endpoint. The path is only echoed back in element ids. */
function model(term: string, subject: string, catalog: string, classNo: string, path: string, root: boolean) {
  const padded = catalog.padEnd(8);
  return {
    Term: term,
    SubjectAreaCode: subject,
    CatalogNumber: padded,
    IsRoot: root,
    SessionGroup: root ? "%" : null,
    ClassNumber: classNo,
    // Discussions and labs are the second enrolment activity of a class.
    SequenceNumber: root ? null : "1",
    Path: path,
    MultiListedClassFlag: "n",
    Token: btoa(padded + path),
  };
}

export const paths = {
  home: "/ro/public/soc",
  subjects: (term: string) =>
    SEARCH_DATA +
    query({ input: JSON.stringify({ search_by: "subject", term_cd: term, ses_grp_cd: "%" }), level: "1" }),
  courses: (term: string, subject: string) =>
    SEARCH_DATA +
    query({
      input: JSON.stringify({ search_by: "subject", term_cd: term, subj_area_cd: subject, ses_grp_cd: "%" }),
      level: "2",
    }),
  /** A course's lectures. */
  lectures: (term: string, c: Course) => sections(model(term, c.subject, c.catalog, c.classNo, "c", true)),
  /** A lecture's discussions and labs. */
  children: (term: string, lec: Section) =>
    sections(model(term, lec.subject, lec.catalog, lec.classNo, `${lec.id}_c`, false)),
};

const html = (body: string) => new DOMParser().parseFromString(body, "text/html");

export function parseTerms(body: string): { terms: Term[]; current: string } {
  // The term picker sits inside a <template>, whose content is not part of the document tree.
  const doc = html(body);
  const roots: ParentNode[] = [doc, ...[...doc.querySelectorAll("template")].map((t) => t.content)];
  const options = roots.flatMap((r) => [...r.querySelectorAll<HTMLOptionElement>("option.select_term")]);
  if (!options.length) throw new Error("Schedule of Classes: no terms found");
  const terms = options.map((o) => ({ code: o.value, name: o.textContent!.trim() }));
  return { terms, current: (options.find((o) => o.hasAttribute("selected")) ?? options[0]).value };
}

export function parseSubjects(body: string): Subject[] {
  const list: { label: string; value: string }[] = JSON.parse(body);
  return list.map((s) => ({ code: s.value.trim(), name: s.label.replace(/\s*\([^()]*\)\s*$/, "") }));
}

/** A subject's courses. The body is empty when the subject offers nothing this term. */
export function parseCourses(body: string, subject: string): Course[] {
  if (!body.trim()) return [];
  const list: { label: string; value: { crs_catlg_no: string; class_no: string } }[] = JSON.parse(body);
  return list.map((c) => {
    const split = c.label.indexOf(" - ");
    return {
      subject,
      catalog: c.value.crs_catlg_no,
      classNo: c.value.class_no,
      number: c.label.slice(0, split),
      title: c.label.slice(split + 3),
    };
  });
}

const DAY: Record<string, number> = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 7 };

function parseClock(s: string): number {
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (!m) throw new Error(`Unreadable time "${s}"`);
  return ((Number(m[1]) % 12) + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
}

/** Meetings from parallel lines of days ("TR") and times ("4pm-5:50pm"). Unscheduled lines are skipped. */
export function parseMeetings(days: string[], times: string[]): Meeting[] {
  const out: Meeting[] = [];
  days.forEach((d, i) => {
    const t = times[i]?.replace(/\s/g, "");
    if (!/^[MTWRFSU]+$/.test(d) || !t?.includes("-")) return;
    const [start, end] = t.split("-").map(parseClock);
    out.push({ days: [...d].map((ch) => DAY[ch]), start, end });
  });
  return out;
}

/** Text of an element, one entry per <br>-separated line. */
export function lines(el: Element | null): string[] {
  if (!el) return [];
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return copy
    .textContent!.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sections of a course from a summary response. `parent` is set when they belong to a lecture. */
export function parseListings(body: string, course: Course, parent?: Section): Listing[] {
  return [...html(body).querySelectorAll(".data_row")].map((row) => {
    const cell = (suffix: string) => lines(row.querySelector(`[id$="-${suffix}"]`));
    const days = cell("days_data");
    const times = lines(row.querySelector(`[id$="-time_data"] > p`));
    const [status = "", ...seats] = cell("status_data");
    const request = row.querySelector("script")?.textContent?.match(/AddToCourseData\("[^"]*",(\{.*?\})\)/);
    if (!request) throw new Error("Schedule of Classes: section without a request model");
    return {
      id: row.id.split("_")[0],
      subject: course.subject,
      catalog: course.catalog,
      classNo: JSON.parse(request[1]).ClassNumber,
      number: course.number,
      title: course.title,
      label: (row.querySelector(".sectionColumn a")?.textContent ?? "").trim(),
      days: days.join(", "),
      time: times.map((t) => t.replace(/\s/g, "")).join(", "),
      location: cell("location_data").join(", "),
      instructor: instructors(cell("instructor_data")),
      units: cell("units_data").join(""),
      meetings: parseMeetings(days, times),
      parent: parent?.id,
      status,
      seats: seats[seats.length - 1] ?? "",
    };
  });
}
