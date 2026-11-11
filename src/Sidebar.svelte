<script lang="ts">
  import CourseItem from "./CourseItem.svelte";
  import PlanClasses from "./PlanClasses.svelte";
  import Settings from "./Settings.svelte";
  import { search, type Entry } from "./search";
  import TermPicker from "./TermPicker.svelte";
  import { store } from "./store.svelte";

  let input: HTMLInputElement;
  let text = $state("");

  let results = $derived(store.index ? search(store.index, text) : []);
  // Course numbers take the width of the longest shown, so titles line up without extra space.
  let numberWidth = $derived(Math.max(0, ...results.map((e) => e.course.number.length)));
  // Results grouped by subject, in the order each subject first appears.
  let grouped = $derived.by(() => {
    const bySubject = new Map<string, Entry[]>();
    for (const e of results) {
      if (!bySubject.has(e.course.subject)) bySubject.set(e.course.subject, []);
      bySubject.get(e.course.subject)!.push(e);
    }
    return [...bySubject.values()];
  });

  // "/" jumps to the search box from anywhere; Escape clears it.
  function onKey(e: KeyboardEvent) {
    if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === "Escape") {
      text = "";
      input.focus();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="top">
  <TermPicker />
  <div class="search">
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:this={input} bind:value={text} placeholder="cs 31, ls7a, …" autofocus spellcheck="false" />
    {#if text}
      <button
        class="clear"
        aria-label="Clear search"
        onclick={() => {
          text = "";
          input.focus();
        }}>x</button
      >
    {/if}
  </div>
</div>

<div class="scroll" style:--number-w="{numberWidth}ch">
  {#if !text.trim()}
    <PlanClasses />
  {:else if !store.index}
    <p class="muted">Loading classes…</p>
  {:else}
    {#each grouped as group (group[0].course.subject)}
      <h2>{group[0].subjectName}</h2>
      {#each group as e (e.course.catalog + e.course.classNo)}
        <CourseItem course={e.course} open={results.length === 1} />
      {/each}
    {:else}
      <p class="muted">no results</p>
    {/each}
  {/if}
</div>

<Settings />

<style>
  .top {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 16px 6px;
  }
  .search {
    position: relative;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg);
    border-radius: var(--radius);
    padding: 9px 36px 9px 12px;
  }
  .clear {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    padding: 0 14px;
    color: var(--muted);
    font-weight: 600;
  }
  input::placeholder {
    color: var(--muted);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 16px 16px;
  }
  p {
    margin: 8px;
  }
</style>
