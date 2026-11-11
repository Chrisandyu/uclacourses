<script lang="ts">
  import { colorOf, textColor } from "./colors";
  import { formatStatus, formatTime, type Listing } from "./soc";
  import { activePlan, isPlanned, store, toggle, toggleOptions } from "./store.svelte";
  import { wrapArrows } from "./wrapArrows";

  let {
    section,
    lecture,
    onpick,
    expand,
  }: {
    section: Listing;
    /** Set for discussions and labs. */
    lecture?: Listing;
    onpick?: () => void;
    /** Set for lectures that have discussions: whether they're listed, and how to flip that. */
    expand?: { open: boolean; toggle: () => void };
  } = $props();

  let added = $derived(isPlanned(section.id));
  // The same colour the section has on the calendar.
  let color = $derived(activePlan() ? colorOf(activePlan()!, section) : "");
  let tone = $derived(/^open/i.test(section.status) ? "green" : /^wait/i.test(section.status) ? "yellow" : "red");
  // "206 left" reads better than "Open" when there is a count.
  let state = $derived(section.seats.match(/^(\d+) Spots? Left/i)?.[1].concat(" left") ?? formatStatus(section.status));
</script>

<button
  class:child={lecture}
  class:added
  style:--c={color}
  style:--t={textColor(color)}
  onclick={() => {
    toggle(section, lecture);
    onpick?.();
  }}
  oncontextmenu={(e) => {
    e.preventDefault();
    toggleOptions(lecture ?? section);
  }}
  onmouseenter={() => (store.preview = section)}
  onmouseleave={() => (store.preview = undefined)}
>
  {#if !lecture}
    <!-- Shows or hides the discussions without adding the lecture. Kept as a blank for lectures without any, so labels line up. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <span
      class="chevron"
      class:open={expand?.open}
      class:blank={!expand}
      onclick={(e) => {
        if (!expand) return;
        e.stopPropagation();
        expand.toggle();
      }}>&gt;</span
    >
  {/if}
  <span class="label">{section.label}</span>
  <!-- These wrap onto a second line when the sidebar is narrow. -->
  <span class="rest" use:wrapArrows>
    <span class="part"><span class="arrow">=&gt;</span><span>{section.days} {formatTime(section.time)}</span></span>
    {#if section.instructor}<span class="part who"><span class="arrow">=&gt;</span><span>{section.instructor}</span></span>{/if}
    <span class="state" style:color="var(--{tone})">{state}</span>
  </span>
</button>

<style>
  button {
    display: flex;
    align-items: baseline;
    gap: 1.25ch;
    width: 100%;
    padding: 7px 10px;
    border-radius: 6px;
  }
  /* A lecture's label starts after the arrow (3ch); a discussion's sits two characters further in. */
  button.child {
    padding-left: calc(10px + 5ch);
  }
  button:hover {
    background: var(--hover);
  }
  button.added {
    background: color-mix(in srgb, var(--c) 30%, var(--bg));
    color: var(--t);
  }
  .chevron.blank {
    visibility: hidden;
  }
  .label {
    flex-shrink: 0;
    width: var(--label-w);
    font-weight: 700;
    white-space: nowrap;
  }
  .rest {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    column-gap: 1.25ch;
    row-gap: 2px;
  }
  .part {
    display: flex;
    font-weight: 600;
    white-space: nowrap;
  }
  /* "=>" is drawn as one arrow by the font's ligatures, in the font's own spacing. */
  .arrow {
    margin-right: 1.25ch;
    font-weight: 400;
    font-variant-ligatures: contextual;
  }
  .part:global(.wrapped) .arrow {
    visibility: hidden;
  }
  .who {
    color: var(--muted);
    font-weight: 500;
  }
  button.added .who {
    color: inherit;
  }
  .state {
    margin-left: auto;
    padding-left: 1ch;
    font-size: 0.92em;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
