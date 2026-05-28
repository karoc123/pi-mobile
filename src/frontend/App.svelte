<script lang="ts">
  import { onMount } from 'svelte';

  import type {
    AgentSnapshot,
    DiffFile,
    FileDocument,
    FileEntry,
    SelectedRepo,
    SessionResponse,
    WebsocketEnvelope,
    WorkspaceEntry
  } from '../shared/contracts.js';
  import BottomNav, { type ViewName } from './components/BottomNav.svelte';
  import ChatView from './components/ChatView.svelte';
  import DiffView from './components/DiffView.svelte';
  import EditorView from './components/EditorView.svelte';
  import LoginScreen from './components/LoginScreen.svelte';
  import WorkspacePicker from './components/WorkspacePicker.svelte';
  import { apiFetch } from './lib/api.js';

  const emptyAgentSnapshot: AgentSnapshot = {
    repo: null,
    isConfigured: false,
    isStreaming: false,
    messages: [],
    tools: [],
    lastError: null
  };

  let authChecked = false;
  let authenticated = false;
  let loginPending = false;
  let loginError = '';
  let workspaceOpen = false;
  let workspaceLoading = false;
  let workspacePath = '.';
  let workspaceEntries: WorkspaceEntry[] = [];
  let currentRepo: SelectedRepo | null = null;
  let view: ViewName = 'chat';

  let diffLoading = false;
  let diffFiles: DiffFile[] = [];
  let revertingHunkId: string | null = null;

  let fileLoading = false;
  let filePath = '.';
  let fileEntries: FileEntry[] = [];
  let selectedDocument: FileDocument | null = null;
  let draftContent = '';
  let editorDirty = false;
  let savingFile = false;

  let agentSnapshot: AgentSnapshot = emptyAgentSnapshot;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  let bannerMessage = '';
  let bannerTone: 'info' | 'success' | 'error' = 'info';

  onMount(() => {
    void initialize();

    return () => {
      socket?.close();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
    };
  });

  async function initialize() {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session');
      authenticated = session.authenticated;
      currentRepo = session.repo;
      authChecked = true;

      if (authenticated) {
        await bootstrapWorkspace();
      }
    } catch (error) {
      authChecked = true;
      loginError = toErrorMessage(error);
    }
  }

  async function bootstrapWorkspace() {
    connectSocket();
    agentSnapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
    currentRepo = agentSnapshot.repo ?? currentRepo;
    await loadWorkspaces('.');

    if (currentRepo) {
      await refreshCurrentRepoData();
    }
  }

  async function login(password: string) {
    loginPending = true;

    try {
      const session = await apiFetch<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      authenticated = session.authenticated;
      currentRepo = session.repo;
      loginError = '';
      await bootstrapWorkspace();
    } catch (error) {
      loginError = toErrorMessage(error);
    } finally {
      loginPending = false;
    }
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    authenticated = false;
    currentRepo = null;
    workspaceOpen = false;
    workspaceEntries = [];
    diffFiles = [];
    fileEntries = [];
    selectedDocument = null;
    draftContent = '';
    editorDirty = false;
    agentSnapshot = emptyAgentSnapshot;
    socket?.close();
  }

  function connectSocket() {
    socket?.close();
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket.onmessage = (event) => handleSocketMessage(JSON.parse(event.data) as WebsocketEnvelope);
    socket.onclose = () => {
      if (authenticated) {
        reconnectTimer = window.setTimeout(() => {
          connectSocket();
        }, 1200);
      }
    };
  }

  function handleSocketMessage(event: WebsocketEnvelope) {
    if (event.type === 'connected') {
      agentSnapshot = event.payload;
      currentRepo = event.payload.repo;
      return;
    }

    if (event.type === 'agent_status') {
      agentSnapshot = {
        ...agentSnapshot,
        ...event.payload,
        repo: event.payload.repo ?? agentSnapshot.repo
      };
      currentRepo = event.payload.repo ?? currentRepo;
      return;
    }

    if (event.type === 'chat_message_added') {
      agentSnapshot = {
        ...agentSnapshot,
        messages: [...agentSnapshot.messages, event.payload.message]
      };
      return;
    }

    if (event.type === 'chat_message_updated') {
      agentSnapshot = {
        ...agentSnapshot,
        messages: agentSnapshot.messages.map((message) =>
          message.id === event.payload.messageId
            ? { ...message, text: event.payload.text, status: event.payload.status }
            : message
        )
      };
      return;
    }

    if (event.type === 'tool_activity') {
      agentSnapshot = {
        ...agentSnapshot,
        tools: [event.payload.tool, ...agentSnapshot.tools.filter((tool) => tool.id !== event.payload.tool.id)].slice(0, 12)
      };
      return;
    }

    if (event.type === 'workspace_changed') {
      void loadDiff();
      if (selectedDocument && !editorDirty && selectedDocument.path === event.payload.path) {
        void openFile(selectedDocument.path);
      }
      return;
    }

    if (event.type === 'repo_selected') {
      currentRepo = event.payload.repo;
      agentSnapshot = {
        ...emptyAgentSnapshot,
        repo: event.payload.repo,
        isConfigured: true
      };
      selectedDocument = null;
      draftContent = '';
      editorDirty = false;
      filePath = '.';
      view = 'chat';
      void refreshCurrentRepoData();
      return;
    }

    if (event.type === 'agent_error') {
      agentSnapshot = {
        ...agentSnapshot,
        lastError: event.payload.message
      };
    }
  }

  async function loadWorkspaces(path: string) {
    workspaceLoading = true;

    try {
      const response = await apiFetch<{
        currentPath: string;
        entries: WorkspaceEntry[];
        currentRepo: SelectedRepo | null;
      }>(`/api/workspaces/browse?path=${encodeURIComponent(path)}`);

      workspacePath = response.currentPath;
      workspaceEntries = response.entries;
      currentRepo = response.currentRepo ?? currentRepo;
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    } finally {
      workspaceLoading = false;
    }
  }

  async function selectRepo(path: string) {
    try {
      await apiFetch('/api/workspaces/select', {
        method: 'POST',
        body: JSON.stringify({ path })
      });
      workspaceOpen = false;
      showBanner('Repository activated.', 'success');
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    }
  }

  async function refreshCurrentRepoData() {
    await Promise.all([loadDiff(), loadFiles('.'), loadAgentState()]);
  }

  async function loadAgentState() {
    agentSnapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
    currentRepo = agentSnapshot.repo;
  }

  async function loadDiff() {
    if (!currentRepo) {
      diffFiles = [];
      return;
    }

    diffLoading = true;

    try {
      const response = await apiFetch<{ files: DiffFile[] }>('/api/git/diff');
      diffFiles = response.files;
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    } finally {
      diffLoading = false;
    }
  }

  async function loadFiles(path: string) {
    if (!currentRepo) {
      fileEntries = [];
      return;
    }

    fileLoading = true;

    try {
      const response = await apiFetch<{ currentPath: string; entries: FileEntry[] }>(`/api/files/browse?path=${encodeURIComponent(path)}`);
      filePath = response.currentPath;
      fileEntries = response.entries;
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    } finally {
      fileLoading = false;
    }
  }

  async function openFile(path: string) {
    try {
      selectedDocument = await apiFetch<FileDocument>(`/api/files/content?path=${encodeURIComponent(path)}`);
      draftContent = selectedDocument.content;
      editorDirty = false;
      view = 'editor';
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    }
  }

  async function saveFile(content: string) {
    if (!selectedDocument) {
      return;
    }

    savingFile = true;

    try {
      await apiFetch('/api/files/write', {
        method: 'POST',
        body: JSON.stringify({ path: selectedDocument.path, content })
      });
      selectedDocument = { ...selectedDocument, content };
      draftContent = content;
      editorDirty = false;
      await loadDiff();
      showBanner('File saved.', 'success');
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    } finally {
      savingFile = false;
    }
  }

  async function sendPrompt(prompt: string) {
    try {
      await apiFetch('/api/agent/prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt })
      });
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    }
  }

  async function abortRun() {
    try {
      await apiFetch('/api/agent/abort', { method: 'POST' });
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    }
  }

  async function revertHunk(diff: string, hunkId: string) {
    revertingHunkId = hunkId;

    try {
      await apiFetch('/api/git/revert-hunk', {
        method: 'POST',
        body: JSON.stringify({ diff })
      });
      await loadDiff();
      if (selectedDocument && !editorDirty) {
        await openFile(selectedDocument.path);
      }
      showBanner('Hunk reverted.', 'success');
    } catch (error) {
      showBanner(toErrorMessage(error), 'error');
    } finally {
      revertingHunkId = null;
    }
  }

  function showBanner(message: string, tone: 'info' | 'success' | 'error') {
    bannerMessage = message;
    bannerTone = tone;
    window.clearTimeout(showBanner.timeoutId);
    showBanner.timeoutId = window.setTimeout(() => {
      bannerMessage = '';
    }, 3500);
  }

  showBanner.timeoutId = 0;

  function toErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unexpected error.';
  }
</script>

{#if !authChecked}
  <main class="app-shell loading-shell">
    <div class="hero-card pulse">
      <p class="eyebrow">PiMobile</p>
      <h1>Preparing workspace...</h1>
    </div>
  </main>
{:else if !authenticated}
  <LoginScreen pending={loginPending} error={loginError} on:submit={(event) => login(event.detail.password)} />
{:else}
  <main class="app-shell">
    <div class="top-bar card-panel">
      <div>
        <p class="eyebrow">Active repository</p>
        <h1>{currentRepo ? currentRepo.name : 'No repo selected'}</h1>
        <p class="subdued">{currentRepo ? currentRepo.relativePath : 'Open the picker and choose a Git repository under your configured workspace root.'}</p>
      </div>
      <div class="top-bar-actions">
        <button class="secondary-button" type="button" on:click={() => (workspaceOpen = true)}>Choose repo</button>
        <button class="ghost-button" type="button" on:click={logout}>Logout</button>
      </div>
    </div>

    {#if bannerMessage}
      <div class:success={bannerTone === 'success'} class:error={bannerTone === 'error'} class="notice floating">{bannerMessage}</div>
    {/if}

    {#if currentRepo}
      {#if view === 'chat'}
        <ChatView
          messages={agentSnapshot.messages}
          tools={agentSnapshot.tools}
          isStreaming={agentSnapshot.isStreaming}
          lastError={agentSnapshot.lastError}
          on:submit={(event) => sendPrompt(event.detail.prompt)}
          on:abort={abortRun}
        />
      {:else if view === 'diff'}
        <DiffView files={diffFiles} loading={diffLoading} revertingHunkId={revertingHunkId} on:revert={(event) => revertHunk(event.detail.diff, event.detail.hunkId)} />
      {:else}
        <EditorView
          entries={fileEntries}
          currentPath={filePath}
          selectedFilePath={selectedDocument?.path ?? ''}
          content={draftContent}
          dirty={editorDirty}
          loading={fileLoading}
          saving={savingFile}
          on:browse={(event) => loadFiles(event.detail.path)}
          on:openFile={(event) => openFile(event.detail.path)}
          on:save={(event) => saveFile(event.detail.content)}
          on:change={(event) => {
            draftContent = event.detail.content;
            editorDirty = selectedDocument ? event.detail.content !== selectedDocument.content : false;
          }}
        />
      {/if}
    {:else}
      <section class="view-shell">
        <div class="empty-state-card">
          <h2>No repository selected</h2>
          <p>Open the repository picker and choose any Git repository below the configured `WORKSPACE_ROOT`.</p>
          <button class="primary-button" type="button" on:click={() => (workspaceOpen = true)}>Open picker</button>
        </div>
      </section>
    {/if}

    <BottomNav currentView={view} disabled={!currentRepo} on:navigate={(event) => (view = event.detail.view)} />
    <WorkspacePicker
      open={workspaceOpen}
      loading={workspaceLoading}
      currentPath={workspacePath}
      currentRepo={currentRepo}
      entries={workspaceEntries}
      on:close={() => (workspaceOpen = false)}
      on:browse={(event) => loadWorkspaces(event.detail.path)}
      on:select={(event) => selectRepo(event.detail.path)}
    />
  </main>
{/if}