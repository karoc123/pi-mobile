<script lang="ts" generics="T extends string | number | boolean">
  interface ChoiceOption<T> {
    value: T;
    label: string;
    description?: string;
    disabled?: boolean;
  }

  interface Props {
    options: ChoiceOption<T>[];
    value: T;
    onchange: (value: T) => void;
    label?: string;
    disabled?: boolean;
    columns?: number;
  }

  const { options, value, onchange, label, disabled = false, columns }: Props = $props();
</script>

<div
  class="choice-group"
  role="group"
  aria-label={label}
  style={columns ? `grid-template-columns: repeat(${columns}, minmax(0, 1fr));` : undefined}
>
  {#each options as option (option.value)}
    <button
      type="button"
      class="choice-item"
      class:selected={option.value === value}
      disabled={disabled || option.disabled}
      onclick={() => onchange(option.value)}
    >
      <span class="choice-label">{option.label}</span>
      {#if option.description}
        <span class="choice-description">{option.description}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .choice-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
    gap: 0.5rem;
  }

  .choice-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.4rem;
    background: var(--surface);
    color: var(--muted);
    font-size: 0.85rem;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  .choice-item:hover:not(:disabled) {
    background: var(--surface-strong);
    color: var(--ink);
  }

  .choice-item.selected {
    border-color: var(--accent);
    background: var(--surface-strong);
    color: var(--ink);
    font-weight: 600;
  }

  .choice-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .choice-label {
    line-height: 1.2;
  }

  .choice-description {
    font-size: 0.72rem;
    color: var(--muted);
    font-weight: normal;
  }
</style>
