<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import type {
    AgentCommandResponse,
    AgentSlashCommand,
    SelectedRepo,
  } from '../../shared/contracts.js';
  import { api, run, toErrorMessage } from '../lib/api.js';
  import { editorState } from '../lib/editor-state.svelte.js';
  import { LiveConnection } from '../lib/live-connection.svelte.js';
  import { toast } from '../lib/toast.svelte.js';
  import AppMenu, { type ThemeName } from './AppMenu.svelte';
  import BottomNav, { type ViewName } from './BottomNav.svelte';
  import ChatView from './ChatView.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import DiffView from './DiffView.svelte';
  import EditorView from './EditorView.svelte';
  import LogView from './LogView.svelte';
  import PiLoginSheet from './PiLoginSheet.svelte';
  import SystemStatus from './SystemStatus.svelte';
  import WorkspacePicker from './WorkspacePicker.svelte';

  type AppViewName = ViewName | 'logs';

  interface Props {
    initialRepo: SelectedRepo | null;
    theme: ThemeName;
    onsetTheme: (value: ThemeName) => void;
    onlogout: () => void;
  }

  const { initialRepo = null, theme, onsetTheme, onlogout }: Props = $props();

  let currentRepo = $state<SelectedRepo | null>(null);
  let view = $state<AppViewName>('chat');
  let workspaceChange = $state({ path: '', version: 0 });

  $effect(() => {
    if (initialRepo && !currentRepo) {
      currentRepo = initialRepo;
    }
  });

  let systemStatusVisible = $state(false);
  let menuOpen = $state(false);
  let workspaceOpen = $state(false);
  let piLoginOpen = $state(false);
  let commandPaletteOpen = $state(false);
  let commandPaletteInitialCommand = $state<string | null>(null);

  let availableCommands = $state<AgentSlashCommand[]>([]);
  let composerPrefill = $state('');
  let composerPrefillToken = $state(0);

  let bannerMessage = $state('');
  let bannerTone = $state<'info' | 'success' | 'error'>('info');

  const unsubscribeToast = toast.subscribe((t) => {
    bannerMessage = t.message;
    bannerTone = t.tone;
  });

  const liveConnection = new LiveConnection({
    onWorkspaceChange: (path) => {
      handleWorkspaceChange(path);
    },
    onRepoSelected: (repo) => {
      currentRepo = repo;
      editorState.reset();
      handleWorkspaceChange();
    },
    onUnauthorized: () => {
      onlogout();
    },
  });

  onMount(() => {
    liveConnection.connect();
  });

  onDestroy(() => {
    unsubscribeToast();
    liveConnection.destroy();
    editorState.reset();
  });

  function handleWorkspaceChange(path = '') {
    workspaceChange = { path, version: workspaceChange.version + 1 };
  }

  function handleRepoSelect(repo: SelectedRepo) {
    currentRepo = repo;
    workspaceOpen = false;
    editorState.reset();
    handleWorkspaceChange();
  }

  function seedComposer(value: string) {
    composerPrefill = value;
    composerPrefillToken += 1;
  }

  async function sendPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return;

    try {
      await api.post('/api/agent/prompt', { prompt: trimmed });
    } catch (error) {
      seedComposer(trimmed);
      toast.show(toErrorMessage(error), 'error');
    }
  }

  function handleChatSubmit(prompt: string) {
    liveConnection.dismissPrompt();
    void sendPrompt(prompt);
  }

  async function abortRun() {
    await run(() => api.post('/api/agent/abort'));
  }

  async function startNewChatFromComposer() {
    if (!currentRepo) return;
    if (!window.confirm('Start new chat?')) return;

    await run(
      () => api.post<AgentCommandResponse>('/api/agent/command', { command: 'new-session' }),
      'Started a new session.',
    );
  }

  function openCommandPalette(initialCommand: string | null = null) {
    if (!currentRepo) return;
    commandPaletteInitialCommand = initialCommand;
    commandPaletteOpen = true;
  }

  function openLogView() {
    menuOpen = false;
    view = 'logs';
  }
</script>

<main class="app-shell">
  <div class="app-chrome-actions">
    <button
      class="status-trigger"
      type="button"
      aria-expanded={systemStatusVisible}
      aria-label={systemStatusVisible ? 'Hide system status' : 'Show system status'}
      onclick={() => (systemStatusVisible = !systemStatusVisible)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M13.4 2.2l-.8 2.1c-.4.1-.7.3-1.1.5L9.4 3.9L7.3 6l.9 2.1c-.2.3-.4.7-.5 1.1l-2.2.8v3l2.2.8c.1.4.3.7.5 1.1l-.9 2.1l2.1 2.1l2.1-.9c.3.2.7.4 1.1.5l.8 2.2h3l.8-2.2c.4-.1.7-.3 1.1-.5l2.1.9l2.1-2.1l-.9-2.1c.2-.3.4-.7.5-1.1l2.2-.8v-3l-2.2-.8c-.1-.4-.3-.7-.5-1.1l.9-2.1l-2.1-2.1l-2.1.9c-.3-.2-.7-.4-1.1-.5l-.8-2.1zm.1 6.1a4 4 0 1 1 0 8a4 4 0 0 1 0-8z"
        />
      </svg>
    </button>
    <button
      class="menu-trigger"
      type="button"
      aria-expanded={menuOpen}
      aria-label={menuOpen ? 'Close workspace menu' : 'Open workspace menu'}
      onclick={() => (menuOpen = !menuOpen)}
    >
      Menu
    </button>
  </div>

  {#if bannerMessage}
    <div
      class:success={bannerTone === 'success'}
      class:error={bannerTone === 'error'}
      class="notice floating"
    >
      {bannerMessage}
    </div>
  {/if}

  {#if systemStatusVisible}
    <SystemStatus
      socketStatus={liveConnection.status}
      reconnectAttempt={liveConnection.reconnectAttempt}
    />
  {/if}

  {#if view === 'logs'}
    <LogView />
  {:else if currentRepo}
    {#key currentRepo.absolutePath}
      {#if view === 'chat'}
        <ChatView
          messages={liveConnection.agentSnapshot.messages}
          runtimePhase={liveConnection.agentSnapshot.runtimePhase}
          pendingMessageCount={liveConnection.agentSnapshot.pendingMessageCount}
          canAbort={liveConnection.agentSnapshot.runtimePhase !== 'idle'}
          lastError={liveConnection.agentSnapshot.lastError}
          usage={liveConnection.agentSnapshot.usage}
          prefillPrompt={composerPrefill}
          prefillToken={composerPrefillToken}
          {availableCommands}
          draftStorageScope={currentRepo.relativePath || currentRepo.absolutePath}
          interactivePrompt={liveConnection.agentSnapshot.interactivePrompt}
          onsubmit={(prompt) => handleChatSubmit(prompt)}
          onabort={abortRun}
          onnewsession={() => void startNewChatFromComposer()}
          onopencommands={() => void openCommandPalette()}
          onopenmodelcommands={() => void openCommandPalette('/model')}
          oninteractivedismiss={() => liveConnection.dismissPrompt()}
        />
      {:else if view === 'diff'}
        <DiffView
          active={view === 'diff'}
          {workspaceChange}
          onworkspacechange={handleWorkspaceChange}
        />
      {:else if view === 'editor'}
        <EditorView
          active={view === 'editor'}
          {workspaceChange}
          onworkspacechange={handleWorkspaceChange}
        />
      {/if}
    {/key}
  {:else}
    <div class="hero-card">
      <p class="eyebrow">Repository</p>
      <h2>No repository selected</h2>
      <p class="subdued">Pick a workspace directory to begin.</p>
      <button class="primary-button" type="button" onclick={() => (workspaceOpen = true)}>
        Choose workspace
      </button>
    </div>
  {/if}

  <BottomNav currentView={view === 'logs' ? 'chat' : view} onnavigate={(next) => (view = next)} />

  <AppMenu
    open={menuOpen}
    {currentRepo}
    {theme}
    onclose={() => (menuOpen = false)}
    onchooseRepo={() => {
      menuOpen = false;
      workspaceOpen = true;
    }}
    onopenLogs={openLogView}
    onopenPiLogin={() => {
      menuOpen = false;
      piLoginOpen = true;
    }}
    {onsetTheme}
    {onlogout}
  />

  <PiLoginSheet open={piLoginOpen} onclose={() => (piLoginOpen = false)} />

  <WorkspacePicker
    open={workspaceOpen}
    {currentRepo}
    onclose={() => (workspaceOpen = false)}
    onselect={handleRepoSelect}
  />

  <CommandPalette
    open={commandPaletteOpen}
    initialCommand={commandPaletteInitialCommand}
    onclose={() => (commandPaletteOpen = false)}
    onprefill={(value) => {
      seedComposer(value);
      commandPaletteOpen = false;
    }}
    onstatechange={(state) => {
      availableCommands = state.availableCommands;
    }}
  />
</main>

<style>
  .app-shell {
    min-height: 100vh;
    padding: 1.25rem 1rem 6.5rem;
    display: grid;
    gap: 1rem;
    align-content: start;
  }

  .app-chrome-actions {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .menu-trigger,
  .status-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 2.25rem;
    padding: 0.4rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    color: var(--ink);
    backdrop-filter: blur(8px);
    font-weight: 500;
    transition: all 0.15s ease;
    cursor: pointer;
  }

  .status-trigger {
    padding: 0.4rem;
    width: 2.25rem;
  }

  .status-trigger svg {
    display: block;
  }

  .menu-trigger:hover,
  .status-trigger:hover {
    background: var(--surface-strong);
    border-color: var(--accent);
  }

  .hero-card {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 0.75rem;
    padding: 1.5rem;
    width: min(100%, 34rem);
    display: grid;
    gap: 0.5rem;
  }

  .hero-card h2 {
    margin: 0.25rem 0;
  }

  @media (min-width: 860px) {
    .app-shell {
      max-width: 1180px;
      margin: 0 auto;
      padding-bottom: 2rem;
    }
  }
</style>
