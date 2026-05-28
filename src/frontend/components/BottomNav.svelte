<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export type ViewName = 'chat' | 'diff' | 'editor';

  export let currentView: ViewName = 'chat';
  export let disabled = false;

  const dispatch = createEventDispatcher<{ navigate: { view: ViewName } }>();

  const items: Array<{ label: string; value: ViewName }> = [
    { label: 'Chat', value: 'chat' },
    { label: 'Diff', value: 'diff' },
    { label: 'Editor', value: 'editor' }
  ];
</script>

<nav class="bottom-nav">
  {#each items as item}
    <button
      type="button"
      class:selected={item.value === currentView}
      disabled={disabled}
      on:click={() => dispatch('navigate', { view: item.value })}
    >
      {item.label}
    </button>
  {/each}
</nav>