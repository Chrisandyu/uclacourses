import { courseKey, type Section } from "./soc";
import type { Plan } from "./store.svelte";

const PALETTE = ["#005A8D", "#FF96AD", "#3E9C9E", "#E07A5F", "#8E7DBE", "#D4A017", "#6A994E", "#022E57"];

export const ENROLLED_COLOR = "#8A98AB";

/** One colour per course, in the order courses were added to the plan. Also right for a course about to be added. */
export function colorOf(plan: Plan, c: Section): string {
  const courses = [...new Set([...plan.classes.map(courseKey), courseKey(c)])];
  return PALETTE[courses.indexOf(courseKey(c)) % PALETTE.length];
}

/** The course colour darkened enough to read as text on the light background. */
export const textColor = (color: string) => `color-mix(in srgb, ${color} 70%, #022E57)`;
