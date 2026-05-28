<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { ChatMessage, ToolActivity } from '../../../src/shared/contracts.js';
  import { renderMarkdown } from '../lib/markdown.js';

  export let messages: ChatMessage[] = [];
  export let tools: ToolActivity[] = [];
  export let isStreaming = false;
  export let lastError: string | null = null;

  const dispatch = createEventDispatcher<{
    submit: { prompt: string };
    abort: void;
  }>();

  let prompt = '';
  let scroller: HTMLDivElement | null = null;

  $: if (scroller) {
    requestAnimationFrame(() => {
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
  }

  function submit() {
    if (prompt.trim().length === 0) {
      return;
    }

    dispatch('submit', { prompt: prompt.trim() });
    prompt = '';
  }
</script>

<section class="view-shell chat-view">
  <div class="section-header">
    <div>
      <p class="eyebrow">Live agent</p>
      <h2>Prompt, stream, inspect</h2>
    </div>
    <button class="ghost-button" type="button" on:click={() => dispatch('abort')} disabled={!isStreaming}>
      Stop run
    </button>
  </div>

  {#if lastError}
    <div class="notice error">{lastError}</div>
  {/if}

  <div class="chat-log" bind:this={scroller}>
    {#if messages.length === 0}
      <article class="empty-state-card">
        <h3>No conversation yet</h3>
        <p>Send the first prompt once a repository is selected. Streaming assistant output and tool activity will appear here.</p>
      </article>
    {/if}

    {#each messages as message}
      <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'} class="message-card">
        <header>
          <strong>{message.role}</strong>
          <span>{message.status === 'streaming' ? 'streaming' : new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </header>
        <div class="markdown-body">{@html renderMarkdown(message.text || '_No text returned._')}</div>
      </article>
    {/each}
  </div>

  <div class="tool-strip">
    {#each tools as tool}
      <div class="tool-chip">
        <strong>{tool.toolName}</strong>
        <span>{tool.status}</span>
      </div>
    {/each}
  </div>

  <div class="composer">
    <textarea bind:value={prompt} rows="4" placeholder="Ask pi to change the active repository..." on:keydown={(event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submit()}></textarea>
    <button class="primary-button" type="button" on:click={submit} disabled={prompt.trim().length === 0}>
      Send prompt
    </button>
  </div>
</section>