<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';

  import type { InteractivePrompt, InteractiveResponse, InteractiveAnswer } from '../../../src/shared/contracts.js';

  export let prompt: InteractivePrompt;

  const dispatch = createEventDispatcher<{
    submit: { response: InteractiveResponse };
    dismiss: void;
  }>();

  let answers: Record<string, string> = {};
  let freeTextValues: Record<string, string> = {};
  let showFreeText: Record<string, boolean> = {};
  let submitted = false;

  function isAnswered(questionId: string) {
    return typeof answers[questionId] === 'string' && answers[questionId].trim().length > 0;
  }

  function selectOption(questionId: string, option: string) {
    answers = {
      ...answers,
      [questionId]: option,
    };
    showFreeText = {
      ...showFreeText,
      [questionId]: false,
    };
  }

  function toggleFreeText(questionId: string) {
    const nextVisible = !showFreeText[questionId];
    showFreeText = {
      ...showFreeText,
      [questionId]: nextVisible,
    };

    if (nextVisible) {
      answers = {
        ...answers,
        [questionId]: freeTextValues[questionId] || '',
      };
    } else {
      answers = {
        ...answers,
        [questionId]: freeTextValues[questionId] || '',
      };
    }
  }

  function handleFreeTextInput(questionId: string, value: string) {
    freeTextValues = {
      ...freeTextValues,
      [questionId]: value,
    };

    if (showFreeText[questionId]) {
      answers = {
        ...answers,
        [questionId]: value,
      };
    }
  }

  $: allAnswered = prompt.questions.every((q) => isAnswered(q.id));

  function submit() {
    if (!allAnswered || submitted) {
      return;
    }

    submitted = true;

    const answerList: InteractiveAnswer[] = prompt.questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] || '',
    }));

    dispatch('submit', {
      response: {
        promptId: prompt.promptId,
        answers: answerList,
      },
    });
  }

  function dismiss() {
    if (submitted) {
      return;
    }

    dispatch('dismiss');
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
        <p class="interactive-label">{question.label}</p>

        <div class="interactive-options">
          {#each question.options as option (option)}
            <button
              class:selected={answers[question.id] === option && !showFreeText[question.id]}
              class="option-chip"
              type="button"
              disabled={submitted}
              on:click={() => selectOption(question.id, option)}
            >
              {option}
            </button>
          {/each}

          {#if question.allowFreeText}
            <button
              class:selected={showFreeText[question.id]}
              class="option-chip option-chip-freetext"
              type="button"
              disabled={submitted}
              on:click={() => toggleFreeText(question.id)}
            >
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
            on:input={(e) => handleFreeTextInput(question.id, (e.target as HTMLInputElement).value)}
          />
        {/if}
      </div>
    {/each}
  </div>

  <footer class="interactive-footer">
    <button
      class="primary-button submit-button"
      type="button"
      disabled={!allAnswered || submitted}
      on:click={submit}
    >
      {submitted ? 'Gesendet ✓' : 'Antwort senden'}
    </button>
    <button
      class="ghost-button compact dismiss-button"
      type="button"
      disabled={submitted}
      on:click={dismiss}
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

  .interactive-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .option-chip {
    min-height: 44px;
    min-width: 60px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--terminal-panel-border);
    border-radius: 20px;
    background: var(--terminal-panel);
    color: var(--terminal-ink);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .option-chip:hover {
    background: var(--terminal-panel-strong);
    border-color: var(--terminal-accent);
  }

  .option-chip.selected {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: #ffffff;
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
