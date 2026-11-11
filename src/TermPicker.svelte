<script lang="ts">
  import { selectTerm, store } from "./store.svelte";

  let open = $state(false);
  let root: HTMLElement;
  let name = $derived(store.terms.find((t) => t.code === store.term)?.name ?? "");

  function pick(code: string) {
    open = false;
    if (code !== store.term) selectTerm(code);
  }

  // A click anywhere else closes the list.
  function outside(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === "Escape" && (open = false)} />

<div class="picker" bind:this={root}>
  <button class="current" onclick={() => (open = !open)}>
    {name}
    <span class="chevron" class:open>&gt;</span>
  </button>
  {#if open}
    <ul>
      {#each store.terms as t (t.code)}
        <li>
          <button class:active={t.code === store.term} onclick={() => pick(t.code)}>{t.name}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    align-self: flex-start;
  }
  .current {
    display: flex;
    align-items: baseline;
    gap: 0.5ch;
    font-weight: 600;
  }
  ul {
    position: absolute;
    top: calc(100% + 6px);
    left: -8px;
    z-index: 10;
    min-width: 200px;
    margin: 0;
    padding: 6px;
    list-style: none;
    background: var(--bg);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px color-mix(in srgb, var(--text) 15%, transparent);
  }
  li button {
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
  }
  li button:hover {
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  }
  li button.active {
    color: var(--accent);
    font-weight: 700;
  }
</style>
