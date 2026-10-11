<script module lang="ts">
  export type ViewName = 'chat' | 'diff' | 'editor';
</script>

<script lang="ts">
  interface Props {
    currentView?: ViewName;
    disabled?: boolean;
    onnavigate?: (view: ViewName) => void;
  }

  const { currentView = 'chat', disabled = false, onnavigate }: Props = $props();

  const items: Array<{ label: string; value: ViewName }> = [
    { label: 'Chat', value: 'chat' },
    { label: 'Diff', value: 'diff' },
    { label: 'Editor', value: 'editor' },
  ];
</script>

<nav class="bottom-nav">
  {#each items as item (item.value)}
    <button
      type="button"
      class:selected={item.value === currentView}
      {disabled}
      onclick={() => onnavigate?.(item.value)}
    >
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    left: 0.75rem;
    right: 0.75rem;
    bottom: 0.75rem;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    padding: 0.4rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    backdrop-filter: blur(12px);
    z-index: 20;
  }

  .bottom-nav button {
    padding: 0.65rem 0.5rem;
    border-radius: 0.5rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    font-weight: 500;
    transition: all 0.15s ease;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  .bottom-nav button:hover {
    background: var(--surface-raised);
    color: var(--ink);
  }

  .bottom-nav button.selected {
    background: var(--surface-strong);
    color: var(--ink);
    border-color: var(--line);
  }

  .bottom-nav button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 859px) {
    .bottom-nav {
      bottom: 0.5rem;
      width: min(32rem, calc(100vw - 0.5rem));
      margin: 0 auto;
      gap: 0.3rem;
      padding: 0.38rem;
    }

    .bottom-nav button {
      padding: 0.45rem 0.5rem;
      font-size: 0.78rem;
    }
  }

  @media (min-width: 860px) {
    .bottom-nav {
      position: sticky;
      bottom: 1rem;
      max-width: 1180px;
      margin: 0 auto;
    }
  }
</style>
