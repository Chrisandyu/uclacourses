<script lang="ts">
  import SectionRow from "./SectionRow.svelte";
  import { socLoad } from "./api";
  import { parseListings, paths, type Course, type Listing } from "./soc";
  import { isPlanned, store } from "./store.svelte";

  let { course, open: startOpen }: { course: Course; open: boolean } = $props();

  let open = $state(false);
  let lectures = $state<Listing[]>();
  /** Discussions and labs, keyed by their lecture's id. */
  let children = $state<Record<string, Listing[]>>({});
  let error = $state("");
  let loaded = false;
  /** Lectures whose discussions are listed or hidden by hand. Others are listed while in the plan. */
  let expanded = $state<Record<string, boolean>>({});
  const isOpen = (id: string) => expanded[id] ?? isPlanned(id);

  // Labels take the width of the longest one, so the arrows after them line up.
  let labelWidth = $derived(
    Math.max(0, ...(lectures ?? []).flatMap((l) => [l, ...(children[l.id] ?? [])]).map((s) => s.label.length)),
  );

  /** Lectures whose discussions have been requested. */
  const started = new Set<string>();

  function loadChildren(term: string, lec: Listing) {
    if (started.has(lec.id)) return;
    started.add(lec.id);
    socLoad(`sections-${term}-${lec.id}`, paths.children(term, lec), (body) => {
      children[lec.id] = parseListings(body, course, lec);
    }).catch((e) => (error = String(e)));
  }

  // Discussions are requested as soon as the lectures are known, from the disk cache or the network.
  function load() {
    if (loaded) return;
    loaded = true;
    const term = store.term!;
    socLoad(`sections-${term}-${course.subject}-${course.catalog}-${course.classNo}`, paths.lectures(term, course), (body) => {
      lectures = parseListings(body, course);
      for (const lec of lectures) loadChildren(term, lec);
    }).catch((e) => (error = String(e)));
  }

  $effect(() => {
    if (startOpen) open = true;
  });

  $effect(() => {
    if (open) load();
  });
</script>

<!-- Pointing at a course starts loading it, so it's usually ready by the click. -->
<button class="head" class:open onclick={() => (open = !open)} onmouseenter={load}>
  <span class="number">{course.number}</span>
  <span class="title">{course.title}</span>
</button>

{#if open}
  <div class="sections" style:--label-w="{labelWidth}ch">
    {#if error}
      <p class="error">{error}</p>
    {:else if !lectures}
      <p class="muted">Loading…</p>
    {:else}
      {#each lectures as lec (lec.id)}
        <SectionRow
          section={lec}
          onpick={() => (expanded[lec.id] = isPlanned(lec.id))}
          expand={children[lec.id]?.length ? { open: isOpen(lec.id), toggle: () => (expanded[lec.id] = !isOpen(lec.id)) } : undefined}
        />
        {#if isOpen(lec.id)}
          {#each children[lec.id] ?? [] as dis (dis.id)}
            <SectionRow section={dis} lecture={lec} />
          {/each}
        {/if}
      {:else}
        <p class="muted">No sections this term.</p>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .head {
    display: grid;
    grid-template-columns: var(--number-w) minmax(0, 1fr);
    gap: 1ch;
    width: 100%;
    padding: 7px 10px;
    border-radius: 6px;
  }
  .head:hover,
  .head.open {
    background: var(--hover);
  }
  .number {
    color: var(--accent);
    font-weight: 700;
  }
  .title {
    overflow-wrap: anywhere;
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 4px 0 12px;
  }
  p {
    margin: 0;
    padding: 4px 8px;
  }
</style>
