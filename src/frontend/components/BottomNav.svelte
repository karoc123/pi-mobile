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
