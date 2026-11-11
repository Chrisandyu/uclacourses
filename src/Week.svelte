<script lang="ts">
  import { onMount } from "svelte";
  import { colorOf, ENROLLED_COLOR, textColor } from "./colors";
  import type { Section } from "./soc";
  import { activePlan, isPlanned, store, toggle, toggleOptions } from "./store.svelte";

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  // Box text sizes in px, and the space a box's padding takes. Used to choose what fits.
  const TITLE_PX = 16;
  const SMALL_PX = 14;
  const LINE_HEIGHT = 1.2;
  const PAD_X = 16;
  const PAD_Y = 6;

  /** planned: in the plan. enrolled: from MyUCLA. option: another discussion to pick. preview: under the mouse. */
  type Kind = "planned" | "enrolled" | "option" | "preview";
  type Item = { section: Section; kind: Kind; color: string; lecture?: Section };
  type Box = Item & { start: number; end: number; column: number; columns: number };
  type Part = { text: string; title: boolean };
  /** One line of box text. A single part may wrap; a line of several parts must fit on one row. */
  type Line = Part[];

  let plan = $derived(activePlan());

  let items = $derived.by(() => {
    if (!plan) return [];
    const out: Item[] = plan.classes.map((c) => ({ section: c, kind: "planned", color: colorOf(plan, c) }));
    const shown = new Set(plan.classes.map((c) => c.id));
    const add = (section: Section, kind: Kind, color: string, lecture?: Section) => {
      if (shown.has(section.id)) return;
      shown.add(section.id);
      out.push({ section, kind, color, lecture });
    };
    if (store.settings.showEnrolled) for (const c of store.enrolled[plan.term] ?? []) add(c, "enrolled", ENROLLED_COLOR);
    for (const sections of Object.values(store.options)) {
      const lecture = sections.length ? { ...sections[0], id: sections[0].parent! } : undefined;
      for (const s of sections) add(s, "option", colorOf(plan, s), lecture);
    }
    if (store.preview) add(store.preview, "preview", colorOf(plan, store.preview));
    return out;
  });

  // 8am to 6pm by default, stretched to whole hours around early or late classes.
  let meetings = $derived(items.flatMap((i) => i.section.meetings));
  let first = $derived(Math.floor(Math.min(8 * 60, ...meetings.map((m) => m.start)) / 60) * 60);
  let last = $derived(Math.ceil(Math.max(18 * 60, ...meetings.map((m) => m.end)) / 60) * 60);
  let dayCount = $derived(meetings.some((m) => m.days.some((d) => d > 5)) ? 7 : 5);
  /** Minutes past each hour that get a lighter line, from the line setting. */
  let subLines = $derived.by(() => {
    const step = store.settings.lineMinutes;
    return Array.from({ length: 60 / step - 1 }, (_, i) => (i + 1) * step);
  });
  let hours = $derived(Array.from({ length: (last - first) / 60 + 1 }, (_, i) => first + i * 60));

  let gridWidth = $state(0);
  let gridHeight = $state(0);
  /** Width of one character as a fraction of the font size. The font is monospaced. */
  let charEm = $state(0.6);

  onMount(() => {
    document.fonts.ready.then(() => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `600 100px ${getComputedStyle(document.body).fontFamily}`;
      charEm = ctx.measureText("M".repeat(10)).width / 1000;
    });
  });

  /** One day's boxes, with overlapping ones placed side by side. */
  function layout(day: number): Box[] {
    const boxes: Box[] = items
      .flatMap((item) =>
        item.section.meetings
          .filter((m) => m.days.includes(day))
          .map((m) => ({ ...item, start: m.start, end: m.end, column: 0, columns: 1 })),
      )
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster: Box[] = [];
    let ends: number[] = [];
    const close = () => cluster.forEach((b) => (b.columns = ends.length));
    for (const box of boxes) {
      // A box starting after everything so far has ended begins a new cluster.
      if (ends.every((end) => end <= box.start)) {
        close();
        cluster = [];
        ends = [];
      }
      const free = ends.findIndex((end) => end <= box.start);
      box.column = free === -1 ? ends.length : free;
      ends[box.column] = box.end;
      cluster.push(box);
    }
    close();
    return boxes;
  }

  /** Rows a text takes when wrapped at word boundaries, or Infinity if a word is too long for a row. */
  function rows(text: string, perRow: number): number {
    let count = 1;
    let used = 0;
    for (const word of text.split(" ")) {
      if (word.length > perRow) return Infinity;
      const need = used ? used + 1 + word.length : word.length;
      if (need > perRow) {
        count++;
        used = word.length;
      } else used = need;
    }
    return count;
  }

  const partWidth = (p: Part) => p.text.length * charEm * (p.title ? TITLE_PX : SMALL_PX);

  function height(lines: Line[], width: number): number {
    return lines.reduce((sum, line) => {
      const px = Math.max(...line.map((p) => (p.title ? TITLE_PX : SMALL_PX))) * LINE_HEIGHT;
      if (line.length === 1) return sum + rows(line[0].text, Math.floor(width / (charEm * (line[0].title ? TITLE_PX : SMALL_PX)))) * px;
      const used = line.reduce((w, p) => w + partWidth(p), 0) + (line.length - 1) * charEm * SMALL_PX;
      return sum + (used <= width ? px : Infinity);
    }, 0);
  }

  /** The fullest text that fits the box: "MATH 32B / Dis 1C / room", down to "MATH Dis 1C" or "MATH". */
  function linesFor(box: Box): Line[] {
    const width = gridWidth / dayCount / box.columns - PAD_X;
    const space = (gridHeight * (box.end - box.start)) / (last - first) - PAD_Y;
    const s = box.section;
    const label = store.settings.showLabels ? s.label : "";
    const course = `${s.subject} ${s.number}`;
    const title = (text: string) => ({ text, title: true });
    const small = (text: string) => ({ text, title: false });
    const choices: Line[][] = [
      [[title(course)], [small(label)], [small(store.settings.showLocation ? s.location : "")]],
      [[title(course)], [small(label)]],
      [[title(course), small(label)]],
      [[title(s.subject), small(label)]],
      [[title(course)]],
      [[title(s.subject)]],
    ].map((lines) => lines.map((line) => line.filter((p) => p.text)).filter((line) => line.length));
    return choices.find((lines) => height(lines, width) <= space) ?? choices[choices.length - 1];
  }

  const hourLabel = (min: number) => `${((min / 60 + 11) % 12) + 1}${min < 12 * 60 ? "am" : "pm"}`;
  const percent = (min: number) => `${((min - first) / (last - first)) * 100}%`;

  function click(box: Box) {
    if (box.kind === "option") toggle(box.section, box.lecture);
  }

  function rightClick(e: MouseEvent, box: Box) {
    e.preventDefault();
    const lecture = box.lecture ?? plan!.classes.find((c) => c.id === box.section.parent) ?? box.section;
    if (box.kind !== "enrolled" && (box.kind === "option" || isPlanned(lecture.id))) toggleOptions(lecture);
  }
</script>

<div class="week">
  <div class="names">
    {#each DAYS.slice(0, dayCount) as name}
      <span>{name}</span>
    {/each}
  </div>

  <div class="grid" bind:clientHeight={gridHeight}>
    {#each hours as h}
      <div class="hour" style:top={percent(h)}><span>{hourLabel(h)}</span></div>
      {#if h < last}
        {#each subLines as m}
          <div class="hour sub" style:top={percent(h + m)}></div>
        {/each}
      {/if}
    {/each}

    <div class="days" bind:clientWidth={gridWidth}>
      {#each { length: dayCount }, d}
        <div class="day">
          {#each layout(d + 1) as box (box.section.id + box.start)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div
              class="box {box.kind}"
              style:--c={box.color}
              style:--t={textColor(box.color)}
              style:top={percent(box.start)}
              style:height="calc({percent(box.end)} - {percent(box.start)})"
              style:left="{(box.column / box.columns) * 100}%"
              style:width="{100 / box.columns}%"
              onclick={() => click(box)}
              oncontextmenu={(e) => rightClick(e, box)}
            >
              <div class="inner">
                {#each linesFor(box) as line}
                  <div>
                    {#each line as part, i}{i ? " " : ""}<span class:title={part.title}>{part.text}</span>{/each}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .week {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    --gutter: 56px;
  }
  .names {
    display: flex;
    padding-left: var(--gutter);
    font-weight: 600;
  }
  .names span {
    flex: 1;
    padding: 0 8px 8px;
  }
  .grid {
    position: relative;
    flex: 1;
    /* Room for the first and last hour labels, which sit centred on their lines. */
    margin: 10px 0;
  }
  .hour {
    position: absolute;
    left: var(--gutter);
    right: 0;
    border-top: 1.5px solid var(--line);
  }
  .hour.sub {
    border-top-width: 1px;
    border-top-color: color-mix(in srgb, var(--line) 60%, var(--bg));
  }
  .hour span {
    position: absolute;
    right: 100%;
    transform: translateY(-50%);
    padding-right: 10px;
    font-size: 15px;
    white-space: nowrap;
  }
  .days {
    position: absolute;
    inset: 0 0 0 var(--gutter);
    display: flex;
  }
  .day {
    position: relative;
    flex: 1;
  }
  .box {
    position: absolute;
    box-sizing: border-box;
    padding: 1px 2px;
  }
  .inner {
    height: 100%;
    box-sizing: border-box;
    padding: 2px 6px;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    background: color-mix(in srgb, var(--c) 26%, var(--bg));
    color: var(--t);
  }
  .inner div {
    font-size: 14px;
    font-weight: 400;
  }
  .inner .title {
    font-size: 16px;
    font-weight: 700;
  }
  .option {
    cursor: pointer;
  }
  .option .inner {
    background: color-mix(in srgb, var(--c) 10%, var(--bg));
    color: color-mix(in srgb, var(--t) 60%, var(--bg));
  }
  .option:nth-child(even) .inner {
    background: color-mix(in srgb, var(--c) 16%, var(--bg));
  }
  .preview .inner {
    opacity: 0.55;
  }
</style>
