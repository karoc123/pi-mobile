<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    onclose: () => void;
    title?: string;
    eyebrow?: string;
    ariaLabel?: string;
    children?: Snippet;
    header?: Snippet;
  }

  const { open = false, onclose, title, eyebrow, ariaLabel, children, header }: Props = $props();

  let dialogElement: HTMLDialogElement | null = $state(null);

  $effect(() => {
    if (!dialogElement) return;

    if (open) {
      if (!dialogElement.open) {
        dialogElement.showModal();
      }
    } else {
      if (dialogElement.open) {
        dialogElement.close();
      }
    }
  });

  function handleCancel(event: Event) {
    event.preventDefault();
    onclose();
  }

  function handleClick(event: MouseEvent) {
    if (event.target === dialogElement) {
      onclose();
    }
  }
</script>

<dialog
  bind:this={dialogElement}
  class="sheet-dialog"
  aria-label={ariaLabel ?? title}
  oncancel={handleCancel}
  onclick={handleClick}
>
  <div class="sheet-dialog-inner">
    {#if header}
      {@render header()}
    {:else if title || eyebrow}
      <div class="sheet-header">
        <div>
          {#if eyebrow}
            <p class="eyebrow">{eyebrow}</p>
          {/if}
          {#if title}
            <h2>{title}</h2>
          {/if}
        </div>
        <button class="ghost-button" type="button" onclick={onclose}>Close</button>
      </div>
    {/if}
    {#if children}
      {@render children()}
    {/if}
  </div>
</dialog>

<style>
  .sheet-dialog {
    margin: auto auto 0 auto;
    width: min(100vw, 42rem);
    max-height: 85dvh;
    padding: 0;
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: 0.75rem 0.75rem 0 0;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .sheet-dialog::backdrop {
    background: var(--overlay);
    backdrop-filter: blur(1px);
  }

  .sheet-dialog-inner {
    padding: 1rem;
    max-height: 85dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    display: grid;
    gap: 1rem;
  }

  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .sheet-header h2 {
    margin: 0.2rem 0 0;
    font-size: 1.15rem;
  }

  .eyebrow {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
