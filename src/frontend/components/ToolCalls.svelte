<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import type { ChatToolCall } from '../../shared/contracts.js';

  const {
    tools = [],
  }: {
    tools?: ChatToolCall[];
  } = $props();

  const openTools = new SvelteSet<string>();

  function resolveToolIcon(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('read')) return 'read';
    if (lower.includes('write') || lower.includes('edit') || lower.includes('patch'))
      return 'write';
    if (lower.includes('search') || lower.includes('grep') || lower.includes('find'))
      return 'search';
    if (
      lower.includes('bash') ||
      lower.includes('run') ||
      lower.includes('test') ||
      lower.includes('build')
    ) {
      return 'terminal';
    }
    return 'generic';
  }

  function iconPath(icon: string): string {
    if (icon === 'read') {
      return 'M4 5a2 2 0 0 1 2-2h11a3 3 0 0 1 3 3v13a1 1 0 0 1-1.447.894A5 5 0 0 0 16 19H6a2 2 0 0 1-2-2V5zm2 0v12h10a7.1 7.1 0 0 1 2 .29V6a1 1 0 0 0-1-1H6z';
    }
    if (icon === 'write') {
      return 'M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.41l-2.5-2.5a1 1 0 0 0-1.41 0l-1.84 1.84l3.75 3.75l1.99-1.68z';
    }
    if (icon === 'search') {
      return 'M15.5 14h-.79l-.28-.27a6 6 0 1 0-.71.71l.27.28v.79L20 21.5L21.5 20l-6-6zM10 15a5 5 0 1 1 0-10a5 5 0 0 1 0 10z';
    }
    if (icon === 'terminal') {
      return 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm3.2 2.7L8.5 10L6.2 12.3l1.1 1.1l3.4-3.4l-3.4-3.4L6.2 7.7zM11 13h6v-1.5h-6V13z';
    }
    return 'M11.3 1.05a1 1 0 0 1 1.4 0l1.11 1.12a2.5 2.5 0 0 0 2.13.67l1.57-.3a1 1 0 0 1 1.17.78l.3 1.57a2.5 2.5 0 0 0 1.36 1.8l1.42.7a1 1 0 0 1 .46 1.34l-.7 1.42a2.5 2.5 0 0 0 0 2.24l.7 1.42a1 1 0 0 1-.46 1.34l-1.42.7a2.5 2.5 0 0 0-1.36 1.8l-.3 1.57a1 1 0 0 1-1.17.78l-1.57-.3a2.5 2.5 0 0 0-2.13.67l-1.11 1.12a1 1 0 0 1-1.4 0L10.2 21.8a2.5 2.5 0 0 0-2.13-.67l-1.57.3a1 1 0 0 1-1.17-.78l-.3-1.57a2.5 2.5 0 0 0-1.36-1.8l-1.42-.7a1 1 0 0 1-.46-1.34l.7-1.42a2.5 2.5 0 0 0 0-2.24l-.7-1.42a1 1 0 0 1 .46-1.34l1.42-.7a2.5 2.5 0 0 0 1.36-1.8l.3-1.57a1 1 0 0 1 1.17-.78l1.57.3a2.5 2.5 0 0 0 2.13-.67l1.1-1.12zM12 15.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z';
  }

  function describeToolStatus(status: ChatToolCall['status']): string {
    if (status === 'running') return 'running';
    if (status === 'error') return 'error';
    if (status === 'aborted') return 'aborted';
    return 'done';
  }
</script>

{#if tools.length > 0}
  <div class="tool-calls-list">
    {#each tools as tool (tool.id)}
      <details
        class="tool-inline-item"
        ontoggle={(event) => {
          if (event.currentTarget.open) openTools.add(tool.id);
          else openTools.delete(tool.id);
        }}
      >
        <summary class="tool-summary-header">
          <span class="tool-summary-icon icon-{resolveToolIcon(tool.name)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d={iconPath(resolveToolIcon(tool.name))} />
            </svg>
          </span>
          <span class="tool-name">{tool.name}</span>
          <span class="tool-status status-{tool.status}">{describeToolStatus(tool.status)}</span>
        </summary>
        {#if openTools.has(tool.id) && tool.detail}
          <pre class="tool-summary-detail">{tool.detail}</pre>
        {/if}
      </details>
    {/each}
  </div>
{/if}

<style>
  .tool-calls-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin: 0.4rem 0;
  }

  .tool-inline-item {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 0.35rem;
    overflow: hidden;
    font-size: 0.8rem;
  }

  .tool-summary-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    min-height: 44px;
    box-sizing: border-box;
    cursor: pointer;
    user-select: none;
    list-style: none;
  }

  .tool-summary-header::-webkit-details-marker {
    display: none;
  }

  .tool-summary-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    flex-shrink: 0;
  }

  .tool-summary-icon svg {
    width: 100%;
    height: 100%;
  }

  .icon-read {
    color: var(--accent);
  }

  .icon-write {
    color: var(--accent);
  }

  .icon-search {
    color: var(--accent);
  }

  .icon-terminal {
    color: var(--success);
  }

  .icon-generic {
    color: var(--muted);
  }

  .tool-name {
    font-weight: 600;
    font-family: 'IBM Plex Mono', monospace;
    flex: 1;
  }

  .tool-status {
    font-size: 0.7rem;
    padding: 0.1rem 0.35rem;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .status-running {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    color: var(--ink);
  }

  .status-complete {
    background: color-mix(in srgb, var(--success) 12%, var(--surface));
    color: var(--ink);
  }

  .status-aborted,
  .status-error {
    background: color-mix(in srgb, var(--danger) 12%, var(--surface));
    color: var(--ink);
  }

  .tool-summary-detail {
    margin: 0;
    padding: 0.5rem;
    border-top: 1px solid var(--line);
    background: var(--surface-strong);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
