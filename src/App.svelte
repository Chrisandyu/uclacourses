<script lang="ts">
  import Sidebar from "./Sidebar.svelte";
  import Week from "./Week.svelte";
  import { activePlan, addPlan, renamePlan, saveSettings, selectPlan, store, termPlans, undo } from "./store.svelte";

  const MIN_SIDEBAR = 300;
  const MAX_SIDEBAR = 640;

  let renaming = $state<number>();

  // Ctrl+Z undoes the last plan change, except while renaming a plan.
  function onKey(e: KeyboardEvent) {
    if (e.key.toLowerCase() !== "z" || !e.ctrlKey || e.shiftKey || renaming !== undefined) return;
    e.preventDefault();
    undo();
  }

  function finishRename(e: Event, id: number) {
    renamePlan(id, (e.target as HTMLInputElement).value);
    renaming = undefined;
  }

  // Dragging the sidebar's right edge resizes it.
  function startResize(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) =>
      (store.settings.sidebarWidth = Math.round(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, m.clientX))));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      saveSettings();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }
</script>

<svelte:window onkeydown={onKey} />

<aside style:width="{store.settings.sidebarWidth}px">
  <Sidebar />
  <div class="resize" role="separator" onpointerdown={startResize}></div>
</aside>

<main>
  <header>
    {#each termPlans() as p (p.id)}
      {#if renaming === p.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          value={p.name}
          autofocus
          onblur={(e) => finishRename(e, p.id)}
          onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      {:else}
        <button class:active={p.id === activePlan()?.id} onclick={() => selectPlan(p.id)} ondblclick={() => (renaming = p.id)}
          >{p.name}</button
        >
      {/if}
    {/each}
    <button class="new" onclick={addPlan}>new plan</button>
  </header>

  {#if store.error}
    <button class="error" onclick={() => (store.error = "")}>{store.error}</button>
  {/if}

  <Week />
</main>

<style>
  aside {
    position: relative;
    flex-shrink: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
  }
  .resize {
    position: absolute;
    top: 0;
    bottom: 0;
    right: -4px;
    width: 8px;
    cursor: col-resize;
    z-index: 1;
  }
  main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 14px 22px 16px;
    gap: 10px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 20px;
    font-size: 1.05em;
  }
  header .new {
    color: var(--muted);
  }
  header button.active {
    color: var(--accent);
    font-weight: 600;
  }
  header input {
    width: 120px;
    color: var(--accent);
    border-bottom: 1px solid var(--accent);
  }
</style>
