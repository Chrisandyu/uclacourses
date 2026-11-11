<script lang="ts">
  import { colorOf, ENROLLED_COLOR, textColor } from "./colors";
  import { courseKey, formatTime, type Section } from "./soc";
  import { activePlan, deletePlan, removeCourse, store, toggleOptions } from "./store.svelte";
  import { wrapArrows } from "./wrapArrows";

  let plan = $derived(activePlan());
  let units = $derived((plan?.classes ?? []).reduce((sum, c) => sum + Number(c.units), 0));
  let enrolled = $derived(store.enrolled[store.term ?? ""] ?? []);
  let confirmDelete = $state(false);
  // Labels take the width of the longest one, so the arrows after them line up.
  let labelWidth = $derived(
    Math.max(0, ...[...(plan?.classes ?? []), ...(store.settings.showEnrolled ? enrolled : [])].map((s) => s.label.length)),
  );

  /** Sections grouped by course, lectures first, in the order courses first appear. */
  function byCourse(sections: Section[]): Section[][] {
    const groups = new Map<string, Section[]>();
    for (const s of sections) {
      if (!groups.has(courseKey(s))) groups.set(courseKey(s), []);
      groups.get(courseKey(s))!.push(s);
    }
    return [...groups.values()].map((g) => [...g.filter((s) => !s.parent), ...g.filter((s) => s.parent)]);
  }
</script>

{#snippet course(sections: Section[], color: string, removable: boolean)}
  {@const lecture = sections.find((s) => !s.parent)}
  <div
    class="course"
    role="listitem"
    oncontextmenu={(e) => {
      if (!removable || !lecture) return;
      e.preventDefault();
      toggleOptions(lecture);
    }}
  >
    <div class="head">
      <span class="name" style:color={textColor(color)}>{sections[0].subject} {sections[0].number}</span>
      {#if removable}
        <button class="remove" onclick={() => removeCourse(courseKey(sections[0]))}>remove</button>
      {/if}
    </div>
    {#each sections as s (s.id)}
      <!-- Each part stays whole; the line breaks between parts when the sidebar is narrow. -->
      <div class="section">
        <span class="label">{s.label}</span>
        <span class="parts" use:wrapArrows>
          {#if s.days || s.time}<span class="part"><span class="arrow">=&gt;</span><span>{s.days} {formatTime(s.time)}</span></span>{/if}
          {#if store.settings.showLocation && s.location}<span class="part where"><span class="arrow">=&gt;</span><span>{s.location}</span></span>{/if}
        </span>
      </div>
    {/each}
  </div>
{/snippet}

<div style:--label-w="{labelWidth}ch">
{#if plan}
  <h2>{plan.name} ({units} units)</h2>
  {#each byCourse(plan.classes) as sections (courseKey(sections[0]))}
    {@render course(sections, colorOf(plan, sections[0]), true)}
  {:else}
    <p class="hint">planned classes go here</p>
  {/each}

  <p class="actions">
    {#if confirmDelete}
      <button class="error" onclick={() => { deletePlan(plan.id); confirmDelete = false; }}>delete {plan.name}</button>
      <button onclick={() => (confirmDelete = false)}>keep</button>
    {:else}
      <button onclick={() => (confirmDelete = true)}>delete plan</button>
    {/if}
  </p>
{/if}

{#if store.settings.showEnrolled && enrolled.length}
  <h2 class="enrolled">Enrolled</h2>
  {#each byCourse(enrolled) as sections (courseKey(sections[0]))}
    {@render course(sections, ENROLLED_COLOR, false)}
  {/each}
{/if}
</div>

<style>
  h2 {
    font-size: 1.2em;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 10px;
  }
  h2.enrolled {
    margin-top: 36px;
  }
  .course {
    padding: 7px 10px;
  }
  .head {
    display: flex;
    gap: 12px;
  }
  .name {
    font-weight: 700;
  }
  .section {
    display: grid;
    grid-template-columns: var(--label-w) minmax(0, 1fr);
    column-gap: 1.25ch;
    padding-left: 1ch;
    font-weight: 500;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    column-gap: 1.25ch;
  }
  .label {
    font-weight: 700;
    white-space: nowrap;
  }
  .part {
    display: flex;
    min-width: 0;
    white-space: nowrap;
  }
  .part.where {
    white-space: normal;
    color: var(--muted);
  }
  /* "=>" is drawn as one arrow by the font's ligatures, in the font's own spacing. */
  .arrow {
    flex-shrink: 0;
    margin-right: 1.25ch;
    font-weight: 400;
    font-variant-ligatures: contextual;
  }
  .part:global(.wrapped) .arrow {
    visibility: hidden;
  }
  .remove {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.92em;
    font-weight: 500;
  }
  p {
    margin: 6px 10px;
  }
  .hint {
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 18px;
    margin-top: 12px;
    font-weight: 600;
  }
</style>
