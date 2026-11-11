<script lang="ts">
  import { activePlan, connect, saveSettings, setSync, store, undo, useFirefox } from "./store.svelte";

  let plan = $derived(activePlan());
  /** Choices for the minutes between calendar lines. */
  const LINE_STEPS = [
    { minutes: 60, label: "1 hr" },
    { minutes: 30, label: "30 min" },
    { minutes: 10, label: "10 min" },
  ];
</script>

<div class="settings">
  <button
    class="toggle"
    onclick={() => {
      store.settings.settingsOpen = !store.settings.settingsOpen;
      saveSettings();
    }}
  >
    <span class="title">Settings</span>
    <span class="chevron" class:open={store.settings.settingsOpen}>&gt;</span>
  </button>
  {#if store.settings.settingsOpen}
  <label>
    <input type="checkbox" bind:checked={store.settings.showLabels} onchange={saveSettings} />
    show section numbers
  </label>
  <label>
    <input type="checkbox" bind:checked={store.settings.showLocation} onchange={saveSettings} />
    show locations
  </label>
  <label>
    <input type="checkbox" bind:checked={store.settings.showEnrolled} onchange={saveSettings} />
    show enrolled classes
  </label>
  <div class="lines">
    <span>calendar lines</span>
    {#each LINE_STEPS as step}
      <label>
        <input
          type="checkbox"
          checked={store.settings.lineMinutes === step.minutes}
          onchange={(e) => {
            // Picking one unpicks the others; unticking the picked one leaves it picked.
            e.currentTarget.checked = true;
            store.settings.lineMinutes = step.minutes;
            saveSettings();
          }}
        />
        {step.label}
      </label>
    {/each}
  </div>
  {#if plan && store.signedIn}
    <label>
      <input type="checkbox" checked={plan.sync} onchange={(e) => setSync(plan, e.currentTarget.checked)} />
      sync {plan.name} with myUCLA
      {#if store.syncing}<span class="muted">syncing…</span>{/if}
    </label>
  {/if}

  {#if store.signedIn === false}
    <p>
      Not signed in:
      <button class="link" onclick={useFirefox}>use Firefox session</button>
      or
      <button class="link" onclick={connect}>log in here</button>
    </p>
  {:else if store.signedIn === undefined}
    <p class="muted">Connecting to MyUCLA…</p>
  {/if}

  <button class="undo link" disabled={!store.canUndo} onclick={undo}>undo (ctrl z)</button>
  <p>right click to show all discussions</p>
  {/if}
</div>

<style>
  .settings {
    padding: 4px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .toggle {
    display: flex;
    align-items: baseline;
    gap: 0.5ch;
    margin-top: 8px;
  }
  .title {
    color: var(--muted);
    font-size: 0.95em;
    font-weight: 600;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .undo {
    align-self: flex-start;
    margin-top: 6px;
    text-decoration: underline;
  }
  .undo:disabled {
    cursor: default;
    opacity: 0.45;
  }
  .lines {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 16px;
    row-gap: 6px;
  }
  p {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.6ch;
  }
</style>
