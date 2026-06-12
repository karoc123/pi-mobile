<script lang="ts">
  import type { InteractivePrompt, InteractiveAnswer } from '../../../src/shared/contracts.js';

  let { prompt, onSubmit, onDismiss }: {
    prompt: InteractivePrompt;
    onSubmit: (formattedText: string) => void;
    onDismiss: () => void;
  } = $props();

  let answers: Record<string, string | string[]> = $state({});
  let freeTextValues: Record<string, string> = $state({});
  let showFreeText: Record<string, boolean> = $state({});
  let submitted = $state(false);

  function formatValue(value: string | string[]): string {
    if (Array.isArray(value)) return value.filter((v) => v.trim().length > 0).join(', ');
    return value;
  }

  function selectOption(questionId: string, option: string, multiple?: boolean) {
    if (submitted) return;

    if (multiple) {
      const current: string[] = Array.isArray(answers[questionId]) ? (answers[questionId] as string[]) : [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      answers[questionId] = next;
    } else {
      answers[questionId] = option;
    }
    showFreeText[questionId] = false;
  }

  function isSelected(questionId: string, option: string, multiple?: boolean) {
    if (multiple) {
      const current: string[] = Array.isArray(answers[questionId]) ? (answers[questionId] as string[]) : [];
      return current.includes(option);
    }
    return !showFreeText[questionId] && answers[questionId] === option;
  }

  function toggleFreeText(questionId: string) {
    if (submitted) return;
    showFreeText[questionId] = !showFreeText[questionId];
    if (showFreeText[questionId]) {
      answers[questionId] = freeTextValues[questionId] || '';
    }
  }

  function handleFreeTextInput(questionId: string, value: string) {
    freeTextValues[questionId] = value;
    if (showFreeText[questionId]) {
      answers[questionId] = value;
    }
  }

  function submit() {
    if (submitted) return;
    submitted = true;

    const lines: string[] = [`Antworten auf: "${prompt.title}"`, ''];
    for (const q of prompt.questions) {
      const val = answers[q.id] !== undefined ? answers[q.id] : '';
      lines.push(`- ${q.label} → ${formatValue(val)}`);
    }

    onSubmit(lines.join('\n'));
  }

  function dismiss() {
    if (submitted) return;
    onDismiss();
  }
</script>

<section class="interactive-card">
  <header class="interactive-header">
    <span class="interactive-icon" aria-hidden="true">🤔</span>
    <strong class="interactive-title">{prompt.title}</strong>
  </header>

  <div class="interactive-questions">
    {#each prompt.questions as question (question.id)}
      <div class="interactive-question">
        <p class="interactive-label">
          {question.label}
          {#if question.multiple}
            <span class="interactive-hint">(Mehrfachauswahl)</span>
          {/if}
        </p>

        <div class="interactive-options">
          {#each question.options as option (option)}
            <button
              class:selected={isSelected(question.id, option, question.multiple)}
              class="option-chip"
              type="button"
              disabled={submitted}
              onclick={() => selectOption(question.id, option, question.multiple)}
            >
              {#if isSelected(question.id, option, question.multiple)}
                <span class="chip-check" aria-hidden="true">✓</span>
              {/if}
              {option}
            </button>
          {/each}

          {#if question.allowFreeText}
            <button
              class:selected={showFreeText[question.id]}
              class="option-chip option-chip-freetext"
              type="button"
              disabled={submitted}
              onclick={() => toggleFreeText(question.id)}
            >
              {#if showFreeText[question.id]}
                <span class="chip-check" aria-hidden="true">✓</span>
              {/if}
              {question.placeholder || 'Andere...'}
            </button>
          {/if}
        </div>

        {#if question.allowFreeText && showFreeText[question.id]}
          <input
            class="freetext-input"
            type="text"
            placeholder={question.placeholder || 'Freitext eingeben...'}
            value={freeTextValues[question.id] || ''}
            disabled={submitted}
            oninput={(e) => handleFreeTextInput(question.id, (e.target as HTMLInputElement).value)}
          />
        {/if}
      </div>
    {/each}
  </div>

  <footer class="interactive-footer">
    <button
      class="primary-button submit-button"
      type="button"
      disabled={submitted}
      onclick={submit}
    >
      {submitted ? 'Gesendet ✓' : 'Antwort senden'}
    </button>
    <button
      class="ghost-button compact dismiss-button"
      type="button"
      disabled={submitted}
      onclick={dismiss}
    >
      abbrechen
    </button>
  </footer>
</section>

<style>
  .interactive-card {
    background: var(--terminal-panel);
    border: 1px solid var(--terminal-panel-border);
    border-radius: 8px;
    margin: 12px 0;
    overflow: hidden;
    box-shadow: 0 2px 8px var(--terminal-shadow-inset);
  }

  .interactive-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: var(--terminal-panel-strong);
    border-bottom: 1px solid var(--terminal-panel-border);
  }

  .interactive-icon {
    font-size: 18px;
    line-height: 1;
  }

  .interactive-title {
    font-size: 14px;
    color: var(--terminal-shell-heading);
  }

  .interactive-questions {
    padding: 4px 14px;
    max-height: 340px;
    overflow-y: auto;
  }

  .interactive-question {
    padding: 10px 0;
    border-bottom: 1px solid var(--terminal-panel-subtle);
  }

  .interactive-question:last-of-type {
    border-bottom: none;
  }

  .interactive-label {
    margin: 0 0 8px 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--terminal-ink);
  }

  .interactive-hint {
    font-size: 11px;
    font-weight: 400;
    color: var(--terminal-muted);
    font-style: italic;
  }

  .interactive-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .option-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    min-width: 60px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border: 2px solid var(--terminal-panel-border);
    border-radius: 22px;
    background: var(--terminal-shell);
    color: var(--terminal-ink);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .option-chip:hover:not(:disabled) {
    background: var(--terminal-panel-strong);
    border-color: var(--terminal-accent);
  }

  .option-chip.selected {
    background: var(--accent) !important;
    border-color: var(--accent-strong) !important;
    color: #ffffff !important;
  }

  .option-chip:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .option-chip-freetext {
    font-style: italic;
    opacity: 0.85;
  }

  .option-chip-freetext.selected {
    font-style: normal;
    opacity: 1;
  }

  .chip-check {
    font-weight: 700;
    font-size: 12px;
  }

  .freetext-input {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 10px 12px;
    font-size: 13px;
    font-family: inherit;
    color: var(--terminal-ink);
    background: var(--terminal-shell);
    border: 1px solid var(--terminal-panel-border);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s;
    touch-action: manipulation;
  }

  .freetext-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .freetext-input:disabled {
    opacity: 0.55;
  }

  .interactive-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 10px 14px;
    background: var(--terminal-panel-strong);
    border-top: 1px solid var(--terminal-panel-border);
    position: sticky;
    bottom: 0;
  }

  .submit-button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 120px;
    min-height: 44px;
  }

  .dismiss-button {
    font-size: 12px;
    color: var(--terminal-muted);
  }
</style>
