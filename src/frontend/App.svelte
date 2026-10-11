<script lang="ts">
  /* eslint-disable svelte/infinite-reactive-loop */
  import { onMount, type ComponentType } from 'svelte';

  import type {
    AgentCommandRequest,
    AgentCommandResponse,
    AgentCommandState,
    AgentSnapshot,
    AgentUsage,
    ChatMessage,
    ToolActivity,
    FileCreateResult,
    FileDocument,
    FileDownloadInfo,
    FileEntry,
    FileMoveResult,
    SelectedRepo,
    SessionResponse,
    WebsocketEnvelope,
  } from '../shared/contracts.js';
  import AppMenu from './components/AppMenu.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import ChatView from './components/ChatView.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import DiffView from './components/DiffView.svelte';
  import LogView from './components/LogView.svelte';
  import LoginScreen from './components/LoginScreen.svelte';
  import PiLoginSheet from './components/PiLoginSheet.svelte';
  import SystemStatus from './components/SystemStatus.svelte';
  import WorkspacePicker from './components/WorkspacePicker.svelte';
  import {
    api,
    apiFetch,
    ApiRequestError,
    run,
    setUnauthorizedHandler,
    toErrorMessage,
  } from './lib/api.js';
  import { copyText } from './lib/clipboard.js';
  import { toast } from './lib/toast.svelte.js';

  type ThemeName = 'vscode-dark' | 'vscode-light';
  type ViewName = 'chat' | 'diff' | 'editor';
  type AppViewName = ViewName | 'logs';
  type AsyncViewName = Exclude<ViewName, 'chat'>;
  type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
  type ToolTraceBatch = {
    id: string;
    boundary: number;
    tools: ToolActivity[];
  };

  const themeStorageKey = 'pimobile.theme';
  const agentStatePollIntervalMs = 7_000;
  const maxToolBatchCount = 8;
  const maxToolsPerBatch = 24;

  const emptyUsage: AgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    contextTokens: null,
    contextWindow: null,
    contextPercent: null,
    modelId: null,
    usingSubscription: false,
    autoCompactEnabled: false,
  };

  const emptyAgentSnapshot: AgentSnapshot = {
    repo: null,
    isStreaming: false,
    runtimePhase: 'idle',
    pendingMessageCount: 0,
    isCompacting: false,
    isRetrying: false,
    isBashRunning: false,
    messages: [],
    tools: [],
    lastError: null,
    usage: emptyUsage,
    interactivePrompt: null,
  };

  let authChecked = false;
  let authenticated = false;
  let workspaceOpen = false;
  let currentRepo: SelectedRepo | null = null;
  let view: AppViewName = 'chat';

  let workspaceChange = { path: '', version: 0 };

  function handleWorkspaceChange(path = '') {
    workspaceChange = { path, version: workspaceChange.version + 1 };
    if (selectedDocument && !editorDirty && (!path || selectedDocument.path === path)) {
      void openFile(selectedDocument.path, false);
    }
  }

  let fileLoading = false;
  let filePath = '.';
  let fileEntries: FileEntry[] = [];
  let selectedDocument: FileDocument | null = null;
  let draftContent = '';
  let editorDirty = false;
  let savingFile = false;
  let creatingFile = false;

  let agentSnapshot: AgentSnapshot = emptyAgentSnapshot;
  let localSystemMessages: ChatMessage[] = [];
  let chatMessages: ChatMessage[] = [];
  let toolTraceBatches: ToolTraceBatch[] = [];
  let toolTraceBoundary = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let socketManualClose = false;
  let socketStatus: SocketStatus = 'offline';
  let socketReconnectAttempt = 0;

  let agentStatePollTimer: number | null = null;

  let bannerMessage = '';
  let bannerTone: 'info' | 'success' | 'error' = 'info';

  toast.subscribe((state) => {
    bannerMessage = state.message;
    bannerTone = state.tone;
  });

  setUnauthorizedHandler(() => {
    expireSession('Session expired. Please sign in again.');
  });
  let menuOpen = false;
  let piLoginOpen = false;
  let lazyViewLoading: AsyncViewName | null = null;
  let lazyViewError = '';
  let editorViewComponent: ComponentType | null = null;
  let editorViewPromise: Promise<void> | null = null;
  let theme: ThemeName = 'vscode-dark';
  let commandPaletteOpen = false;
  let commandStateLoading = false;
  let commandBusy = false;
  let commandState: AgentCommandState | null = null;
  let commandPaletteInitialCommand: string | null = null;
  let commandPaletteSelectionToken = 0;
  let composerPrefill = '';
  let composerPrefillToken = 0;

  let systemStatusVisible = false;
  let dismissedPromptId: string | null = null;

  onMount(() => {
    initializeTheme();
    void initialize();

    return () => {
      stopAgentStatePolling();
      closeSocket();
    };
  });

  $: if (currentRepo && view === 'editor') {
    void ensureEditorViewLoaded();
  }

  $: chatMessages = [...agentSnapshot.messages, ...localSystemMessages];

  $: {
    const shouldPollAgentState =
      authenticated &&
      !!currentRepo &&
      (socketStatus !== 'connected' || agentSnapshot.runtimePhase !== 'idle');

    if (shouldPollAgentState) {
      startAgentStatePolling();
    } else {
      stopAgentStatePolling();
    }
  }

  async function initialize() {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session');
      authenticated = session.authenticated;
      currentRepo = session.repo;
      authChecked = true;

      if (authenticated) {
        try {
          await bootstrapWorkspace();
        } catch (error) {
          resetAuthenticatedState(toErrorMessage(error));
        }
      }
    } catch (error) {
      authChecked = true;
      resetAuthenticatedState(toErrorMessage(error));
    }
  }

  function initializeTheme() {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    if (storedTheme === 'vscode-dark' || storedTheme === 'vscode-light') {
      setTheme(storedTheme, false);
      return;
    }

    setTheme(
      window.matchMedia('(prefers-color-scheme: light)').matches ? 'vscode-light' : 'vscode-dark',
      false,
    );
  }

  function setTheme(nextTheme: ThemeName, persist = true) {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;

    if (persist) {
      window.localStorage.setItem(themeStorageKey, nextTheme);
    }
  }

  function seedComposer(nextPrompt: string) {
    composerPrefill = nextPrompt;
    composerPrefillToken += 1;
    view = 'chat';
  }

  async function bootstrapWorkspace() {
    connectSocket();

    try {
      agentSnapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
      currentRepo = agentSnapshot.repo ?? currentRepo;

      if (currentRepo) {
        await refreshCurrentRepoData();
      }
    } catch (error) {
      closeSocket();
      throw error;
    }
  }

  async function ensureEditorViewLoaded() {
    if (editorViewComponent || editorViewPromise) {
      return editorViewPromise;
    }

    lazyViewLoading = 'editor';
    lazyViewError = '';
    editorViewPromise = import('./components/EditorView.svelte')
      .then((module) => {
        editorViewComponent = module.default;
      })
      .catch((error) => {
        lazyViewError = toErrorMessage(error);
      })
      .finally(() => {
        if (lazyViewLoading === 'editor') {
          lazyViewLoading = null;
        }

        editorViewPromise = null;
      });

    return editorViewPromise;
  }

  function connectSocket() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    socketManualClose = true;
    socket?.close();
    socketManualClose = false;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const nextSocket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket = nextSocket;
    socketStatus = socketReconnectAttempt > 0 ? 'reconnecting' : 'connecting';

    nextSocket.onopen = () => {
      if (socket !== nextSocket) {
        return;
      }

      socketStatus = 'connected';
      socketReconnectAttempt = 0;
    };

    nextSocket.onmessage = (event) => {
      handleSocketMessage(JSON.parse(event.data) as WebsocketEnvelope);
    };

    nextSocket.onerror = () => {
      if (socket !== nextSocket) {
        return;
      }

      if (socketStatus !== 'connected') {
        socketStatus = 'reconnecting';
      }
    };

    nextSocket.onclose = () => {
      if (socket !== nextSocket) {
        return;
      }

      socket = null;

      if (!authenticated || socketManualClose) {
        socketStatus = 'offline';
        return;
      }

      socketStatus = 'reconnecting';
      socketReconnectAttempt += 1;
      const retryDelay = Math.min(10_000, 1_200 * Math.max(1, socketReconnectAttempt));
      reconnectTimer = window.setTimeout(() => {
        connectSocket();
      }, retryDelay);
      void ensureSessionStillValid();
    };
  }

  function closeSocket() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket) {
      socketManualClose = true;
      socket.close();
      socketManualClose = false;
      socket = null;
    }

    socketStatus = 'offline';
  }

  function navigateMainView(nextView: ViewName) {
    view = nextView;

    if (nextView === 'chat' && authenticated && !!currentRepo) {
      void loadAgentState({ silent: true });
    }
  }

  function createToolBatchId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `tool-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function resetToolTraceBatches() {
    toolTraceBatches = [];
    toolTraceBoundary = 0;
  }

  function setToolTraceFromSnapshot(tools: ToolActivity[]) {
    if (tools.length === 0) {
      toolTraceBatches = [];
      return;
    }

    toolTraceBatches = [
      {
        id: createToolBatchId(),
        boundary: toolTraceBoundary,
        tools: tools.slice(0, maxToolsPerBatch),
      },
    ];
  }

  function markToolTraceBoundary() {
    toolTraceBoundary += 1;
  }

  function appendToolTrace(tool: ToolActivity) {
    const activeBatch = toolTraceBatches[0];

    if (!activeBatch || activeBatch.boundary !== toolTraceBoundary) {
      toolTraceBatches = [
        {
          id: createToolBatchId(),
          boundary: toolTraceBoundary,
          tools: [tool],
        },
        ...toolTraceBatches,
      ].slice(0, maxToolBatchCount);
      return;
    }

    const updatedBatch: ToolTraceBatch = {
      ...activeBatch,
      tools: [tool, ...activeBatch.tools.filter((entry) => entry.id !== tool.id)].slice(
        0,
        maxToolsPerBatch,
      ),
    };

    toolTraceBatches = [updatedBatch, ...toolTraceBatches.slice(1)];
  }

  function syncToolTraceFromSnapshot(snapshot: AgentSnapshot) {
    if (snapshot.tools.length > 0) {
      setToolTraceFromSnapshot(snapshot.tools);
      return;
    }

    if (snapshot.messages.length === 0) {
      resetToolTraceBatches();
    }
  }

  function handleSocketMessage(event: WebsocketEnvelope) {
    if (event.type === 'snapshot') {
      // On reconnect or reset, do not restore a prompt the user already dismissed.
      const serverPrompt = event.payload.interactivePrompt ?? null;
      const interactivePrompt =
        serverPrompt && serverPrompt.promptId === dismissedPromptId ? null : serverPrompt;

      agentSnapshot = {
        ...event.payload,
        interactivePrompt,
      };
      currentRepo = event.payload.repo;
      syncToolTraceFromSnapshot(event.payload);
      socketStatus = 'connected';
      return;
    }

    if (event.type === 'agent_status') {
      // agent_status intentionally excludes interactivePrompt.
      // Interactive prompts arrive exclusively via the dedicated
      // interactive_prompt event (and the snapshot on reconnect).
      agentSnapshot = {
        ...agentSnapshot,
        ...event.payload,
        repo: event.payload.repo ?? agentSnapshot.repo,
      };
      currentRepo = event.payload.repo ?? currentRepo;
      return;
    }

    if (event.type === 'chat_message_added') {
      agentSnapshot = {
        ...agentSnapshot,
        messages: [...agentSnapshot.messages, event.payload.message],
      };

      if (event.payload.message.role === 'user' || event.payload.message.role === 'assistant') {
        markToolTraceBoundary();
      }

      return;
    }

    if (event.type === 'chat_message_updated') {
      agentSnapshot = {
        ...agentSnapshot,
        messages: agentSnapshot.messages.map((message) =>
          message.id === event.payload.messageId
            ? { ...message, text: event.payload.text, status: event.payload.status }
            : message,
        ),
      };
      return;
    }

    if (event.type === 'tool_activity') {
      agentSnapshot = {
        ...agentSnapshot,
        tools: [
          event.payload.tool,
          ...agentSnapshot.tools.filter((tool) => tool.id !== event.payload.tool.id),
        ].slice(0, 12),
      };
      appendToolTrace(event.payload.tool);
      return;
    }

    if (event.type === 'workspace_changed') {
      handleWorkspaceChange(event.payload.path);
      return;
    }

    if (event.type === 'interactive_prompt') {
      // Always accept the dedicated prompt event (it represents a fresh ask_user call).
      // Clear any previous dismiss so it can be shown.
      dismissedPromptId = null;
      agentSnapshot = {
        ...agentSnapshot,
        interactivePrompt: event.payload,
      };
      return;
    }

    if (event.type === 'repo_selected') {
      currentRepo = event.payload.repo;
      commandPaletteOpen = false;
      commandState = null;
      resetToolTraceBatches();
      localSystemMessages = [];
      agentSnapshot = {
        ...emptyAgentSnapshot,
        repo: event.payload.repo,
      };
      selectedDocument = null;
      draftContent = '';
      editorDirty = false;
      filePath = '.';
      view = view === 'logs' ? view : 'chat';
      void refreshCurrentRepoData();
      return;
    }

    if (event.type === 'agent_error') {
      agentSnapshot = {
        ...agentSnapshot,
        lastError: event.payload.message,
      };
    }
  }

  async function refreshCurrentRepoData() {
    handleWorkspaceChange();
    await Promise.all([loadFiles('.'), loadAgentState(), loadCommandState()]);
  }

  function openLogView() {
    menuOpen = false;
    view = 'logs';
  }

  async function loadAgentState(options: { silent?: boolean } = {}) {
    try {
      const snapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
      agentSnapshot = snapshot;
      currentRepo = snapshot.repo;
      syncToolTraceFromSnapshot(snapshot);
    } catch (error) {
      if (!options.silent) {
        handleApiFailure(error);
      }
    }
  }

  async function loadCommandState() {
    if (!currentRepo) {
      commandState = null;
      return;
    }

    commandStateLoading = true;

    try {
      commandState = await apiFetch<AgentCommandState>('/api/agent/command-state');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      commandStateLoading = false;
    }
  }

  async function openCommandPalette(initialCommand: string | null = null) {
    if (!currentRepo) {
      return;
    }

    commandPaletteInitialCommand = initialCommand;
    commandPaletteSelectionToken += 1;
    commandPaletteOpen = true;
    await loadCommandState();
  }

  async function startNewChatFromComposer() {
    if (!currentRepo || commandBusy) {
      return;
    }

    if (!window.confirm('Start new chat?')) {
      return;
    }

    localSystemMessages = [];
    await executePaletteCommand({ command: 'new-session' });
  }

  async function loadFiles(path: string) {
    if (!currentRepo) {
      fileEntries = [];
      return;
    }

    fileLoading = true;

    try {
      const response = await apiFetch<{ currentPath: string; entries: FileEntry[] }>(
        `/api/files/browse?path=${encodeURIComponent(path)}`,
      );
      filePath = response.currentPath;
      fileEntries = response.entries;
    } catch (error) {
      handleApiFailure(error);
    } finally {
      fileLoading = false;
    }
  }

  async function openFile(path: string, switchView = true) {
    try {
      const fileDoc = await apiFetch<FileDocument>(
        `/api/files/content?path=${encodeURIComponent(path)}`,
      );

      if (fileDoc.kind === 'binary' && fileDoc.binaryContentBase64) {
        saveBase64File(
          fileDoc.binaryContentBase64,
          fileDoc.mimeType,
          fileDoc.path.split('/').pop() || 'download',
        );
        showBanner('Binary file downloaded.', 'success');
        return;
      }

      selectedDocument = fileDoc;
      draftContent = selectedDocument.kind === 'text' ? selectedDocument.content : '';
      editorDirty = false;
      if (switchView) {
        view = 'editor';
      }
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function saveFile(content: string) {
    if (!selectedDocument) {
      return;
    }

    await run(
      async () => {
        await api.post('/api/files/write', { path: selectedDocument!.path, content });
        selectedDocument = { ...selectedDocument!, content };
        draftContent = content;
        editorDirty = false;
        handleWorkspaceChange(selectedDocument.path);
      },
      'File saved.',
      (busy) => {
        savingFile = busy;
      },
    );
  }

  async function runFileAction(
    action: string,
    body: Record<string, string>,
    successMessage: string,
    openResult: boolean,
  ) {
    return await run(
      async () => {
        const response = await api.post<FileCreateResult | FileMoveResult>(
          `/api/files/${action}`,
          body,
        );
        const resultPath = 'toPath' in response ? response.toPath : response.path;
        await loadFiles(parentDirectoryFor(resultPath));

        if (openResult) {
          await openFile(resultPath);
        }

        return resultPath;
      },
      successMessage,
      (busy) => {
        creatingFile = busy;
      },
    );
  }

  const createFile = (path: string, content: string) =>
    runFileAction('create', { path, content }, 'File created.', true);
  const createDirectory = (path: string) =>
    runFileAction('create-directory', { path }, 'Folder created.', false);
  const duplicateFile = (sourcePath: string, targetPath: string) =>
    runFileAction('duplicate', { sourcePath, targetPath }, 'File duplicated.', true);
  const renameFile = (fromPath: string, toPath: string) =>
    runFileAction('rename', { fromPath, toPath }, 'File renamed.', true);
  const moveFile = (fromPath: string, toPath: string) =>
    runFileAction('move', { fromPath, toPath }, 'File moved.', true);
  const uploadFile = (path: string, contentBase64: string) =>
    runFileAction('upload', { path, contentBase64 }, 'File uploaded.', true);

  async function downloadFile(filePathToDownload: string) {
    try {
      const info = await apiFetch<FileDownloadInfo>(
        `/api/files/download?path=${encodeURIComponent(filePathToDownload)}`,
      );

      if (!info.contentBase64) {
        showBanner('Download failed: no content received.', 'error');
        return;
      }

      saveBase64File(info.contentBase64, info.mimeType, info.name);
      showBanner('File downloaded.', 'success');
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function deleteFile(path: string) {
    const deletedPath = await runFileAction('delete', { path }, 'File deleted.', false);

    if (deletedPath && selectedDocument?.path === deletedPath) {
      selectedDocument = null;
      draftContent = '';
      editorDirty = false;
    }
  }

  /** Sendet eine User-Nachricht und räumt dabei offene InteractivePrompts weg. */
  function handleChatSubmit(prompt: string) {
    dismissedPromptId = null;
    if (agentSnapshot.interactivePrompt) {
      agentSnapshot = { ...agentSnapshot, interactivePrompt: null };
    }
    void sendPrompt(prompt);
  }

  async function sendPrompt(prompt: string) {
    const trimmed = prompt.trim();

    if (trimmed.length === 0) {
      return;
    }

    // Interactive-Prompt-Antworten durchlaufen den gleichen Pfad
    // Der Server cleared interactivePrompt beim prompt()-Aufruf

    try {
      await apiFetch('/api/agent/prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: trimmed }),
      });
    } catch (error) {
      seedComposer(trimmed);
      handleApiFailure(error);
    }
  }

  async function abortRun() {
    await run(() => api.post('/api/agent/abort'));
  }

  async function executePaletteCommand(request: AgentCommandRequest) {
    commandBusy = true;

    try {
      const response = await apiFetch<AgentCommandResponse>('/api/agent/command', {
        method: 'POST',
        body: JSON.stringify(request),
      });

      await loadAgentState();

      if (response.prompt) {
        seedComposer(response.prompt);
      }

      if (response.message) {
        showBanner(response.message, 'success');
      }

      const refreshStateCommands: AgentCommandRequest['command'][] = [
        'set-model',
        'set-thinking',
        'set-auto-compact',
        'set-steering-mode',
        'set-follow-up-mode',
        'set-auto-retry',
        'abort-retry',
        'run-bash',
        'abort-bash',
        'set-session-name',
      ];
      const closePaletteCommands: AgentCommandRequest['command'][] = [
        'new-session',
        'resume-session',
        'navigate-tree',
        'fork-session',
        'export-session',
      ];

      if (refreshStateCommands.includes(request.command)) {
        await loadCommandState();
      }

      if (closePaletteCommands.includes(request.command)) {
        commandPaletteOpen = false;
        commandState = null;

        if (request.command === 'new-session' || request.command === 'resume-session') {
          resetToolTraceBatches();
          localSystemMessages = [];
        }

        await loadCommandState();
      }
    } catch (error) {
      handleApiFailure(error);
    } finally {
      commandBusy = false;
    }
  }

  async function copyLastAssistantReply() {
    const lastAssistantReply = [...agentSnapshot.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.text.trim().length > 0);

    if (!lastAssistantReply) {
      showBanner('No assistant reply to copy yet.', 'info');
      return;
    }

    const copied = await copyText(lastAssistantReply.text);
    commandPaletteOpen = false;
    if (copied) {
      showBanner('Last assistant reply copied.', 'success');
    } else {
      showBanner('Failed to copy to clipboard.', 'error');
    }
  }

  function startAgentStatePolling() {
    if (agentStatePollTimer !== null) {
      return;
    }

    void loadAgentState({ silent: true });

    agentStatePollTimer = window.setInterval(() => {
      void loadAgentState({ silent: true });
    }, agentStatePollIntervalMs);
  }

  function stopAgentStatePolling() {
    if (agentStatePollTimer !== null) {
      window.clearInterval(agentStatePollTimer);
      agentStatePollTimer = null;
    }
  }

  async function ensureSessionStillValid() {
    try {
      const session = await apiFetch<SessionResponse>('/api/auth/session');

      if (!session.authenticated) {
        expireSession('Session expired. Please sign in again.');
      }
    } catch {
      // Ignore transient failures during reconnect.
    }
  }

  function handleApiFailure(error: unknown) {
    if (error instanceof ApiRequestError && error.status === 401) {
      expireSession('Session expired. Please sign in again.');
      return;
    }

    showBanner(toErrorMessage(error), 'error');
  }

  function expireSession(message: string) {
    resetAuthenticatedState(message);
  }

  function resetAuthenticatedState(message: string) {
    authChecked = true;
    authenticated = false;
    currentRepo = null;
    view = 'chat';
    menuOpen = false;
    commandPaletteOpen = false;
    commandState = null;
    workspaceOpen = false;
    piLoginOpen = false;
    workspaceChange = { path: '', version: 0 };

    fileEntries = [];
    filePath = '.';
    selectedDocument = null;
    draftContent = '';
    editorDirty = false;
    agentSnapshot = emptyAgentSnapshot;
    resetToolTraceBatches();
    localSystemMessages = [];
    chatMessages = [];
    dismissedPromptId = null;
    closeSocket();
    stopAgentStatePolling();
    socketReconnectAttempt = 0;
    if (message) {
      showBanner(message, 'error');
    }
  }

  function saveBase64File(contentBase64: string, mimeType: string | null, fileName: string) {
    const bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0));
    const blobUrl = URL.createObjectURL(
      new Blob([bytes], { type: mimeType || 'application/octet-stream' }),
    );
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  function parentDirectoryFor(relativePath: string) {
    if (relativePath === '.' || relativePath.length === 0) {
      return '.';
    }

    const segments = relativePath.split('/').filter(Boolean);
    segments.pop();
    return segments.length === 0 ? '.' : segments.join('/');
  }

  function showBanner(message: string, tone: 'info' | 'success' | 'error') {
    toast.show(message, tone);
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
  <LoginScreen
    onLogin={async (session) => {
      authenticated = session.authenticated;
      currentRepo = session.repo;
      try {
        await bootstrapWorkspace();
      } catch (error) {
        resetAuthenticatedState(toErrorMessage(error));
      }
    }}
  />
{:else}
  <main class="app-shell">
    <div class="app-chrome-actions">
      <button
        class="status-trigger"
        type="button"
        aria-expanded={systemStatusVisible}
        aria-label={systemStatusVisible ? 'Hide system status' : 'Show system status'}
        on:click={() => (systemStatusVisible = !systemStatusVisible)}
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
        on:click={() => (menuOpen = !menuOpen)}
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
      <SystemStatus {socketStatus} reconnectAttempt={socketReconnectAttempt} />
    {/if}

    {#if view === 'logs'}
      <LogView />
    {:else if currentRepo}
      {#if view === 'chat'}
        <ChatView
          messages={chatMessages}
          toolBatches={toolTraceBatches}
          runtimePhase={agentSnapshot.runtimePhase}
          pendingMessageCount={agentSnapshot.pendingMessageCount}
          canAbort={agentSnapshot.runtimePhase !== 'idle'}
          lastError={agentSnapshot.lastError}
          usage={agentSnapshot.usage}
          prefillPrompt={composerPrefill}
          prefillToken={composerPrefillToken}
          availableCommands={commandState?.availableCommands ?? []}
          draftStorageScope={currentRepo.relativePath || currentRepo.absolutePath}
          interactivePrompt={agentSnapshot.interactivePrompt}
          on:submit={(event) => handleChatSubmit(event.detail.prompt)}
          on:abort={abortRun}
          on:newSession={() => void startNewChatFromComposer()}
          on:openCommands={() => void openCommandPalette()}
          on:openModelCommands={() => void openCommandPalette('/model')}
          on:interactiveDismiss={() => {
            dismissedPromptId = agentSnapshot.interactivePrompt?.promptId ?? null;
            agentSnapshot = { ...agentSnapshot, interactivePrompt: null };
          }}
        />
      {:else if view === 'diff'}
        <DiffView
          active={view === 'diff'}
          {workspaceChange}
          onworkspacechange={handleWorkspaceChange}
        />
      {:else}
        {#if editorViewComponent}
          <svelte:component
            this={editorViewComponent}
            entries={fileEntries}
            currentPath={filePath}
            selectedFilePath={selectedDocument?.path ?? ''}
            content={draftContent}
            fileKind={selectedDocument?.kind ?? 'text'}
            imageDataUrl={selectedDocument?.imageDataUrl ?? ''}
            dirty={editorDirty}
            loading={fileLoading}
            saving={savingFile}
            creating={creatingFile}
            on:browse={(event: CustomEvent<{ path: string }>) => loadFiles(event.detail.path)}
            on:openFile={(event: CustomEvent<{ path: string }>) => openFile(event.detail.path)}
            on:save={(event: CustomEvent<{ content: string }>) => saveFile(event.detail.content)}
            on:createFile={(event: CustomEvent<{ path: string; content: string }>) =>
              createFile(event.detail.path, event.detail.content)}
            on:createDirectory={(event: CustomEvent<{ path: string }>) =>
              createDirectory(event.detail.path)}
            on:duplicateFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) =>
              duplicateFile(event.detail.fromPath, event.detail.toPath)}
            on:renameFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) =>
              renameFile(event.detail.fromPath, event.detail.toPath)}
            on:moveFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) =>
              moveFile(event.detail.fromPath, event.detail.toPath)}
            on:deleteFile={(event: CustomEvent<{ path: string }>) => deleteFile(event.detail.path)}
            on:uploadFile={(event: CustomEvent<{ path: string; contentBase64: string }>) =>
              uploadFile(event.detail.path, event.detail.contentBase64)}
            on:downloadFile={(event: CustomEvent<{ path: string }>) =>
              downloadFile(event.detail.path)}
            on:change={(event: CustomEvent<{ content: string }>) => {
              draftContent = event.detail.content;
              editorDirty = selectedDocument
                ? event.detail.content !== selectedDocument.content
                : false;
            }}
          />
        {:else if lazyViewLoading === 'editor'}
          <section class="view-shell">
            <div class="empty-state-card compact">
              <h2>Loading editor...</h2>
              <p>CodeMirror is loaded only when you open the editor view.</p>
            </div>
          </section>
        {:else}
          <section class="view-shell">
            <div class="empty-state-card compact">
              <h2>Could not load editor view</h2>
              <p>{lazyViewError || 'Unexpected lazy-load error.'}</p>
            </div>
          </section>
        {/if}
      {/if}
    {:else}
      <section class="view-shell">
        <div class="empty-state-card">
          <h2>No repository selected</h2>
          <p>
            Open the repository picker and choose any Git repository below the configured
            WORKSPACE_ROOT.
          </p>
          <button class="primary-button" type="button" on:click={() => (workspaceOpen = true)}
            >Open picker</button
          >
        </div>
      </section>
    {/if}

    <BottomNav
      currentView={view === 'logs' ? 'chat' : view}
      disabled={!currentRepo}
      on:navigate={(event) => navigateMainView(event.detail.view)}
    />
    <AppMenu
      open={menuOpen}
      {currentRepo}
      {theme}
      onclose={() => (menuOpen = false)}
      onchooseRepo={() => {
        menuOpen = false;
        workspaceOpen = true;
      }}
      onopenLogs={() => openLogView()}
      onopenPiLogin={() => {
        menuOpen = false;
        piLoginOpen = true;
      }}
      onsetTheme={(nextTheme) => setTheme(nextTheme)}
      onlogout={() => resetAuthenticatedState('')}
    />
    <PiLoginSheet open={piLoginOpen} onclose={() => (piLoginOpen = false)} />
    <WorkspacePicker
      open={workspaceOpen}
      {currentRepo}
      onclose={() => (workspaceOpen = false)}
      onselect={(repo) => {
        currentRepo = repo;
        workspaceOpen = false;
        void refreshCurrentRepoData();
      }}
    />
    <CommandPalette
      open={commandPaletteOpen}
      loading={commandStateLoading}
      busy={commandBusy}
      state={commandState}
      {theme}
      initialCommand={commandPaletteInitialCommand}
      selectionToken={commandPaletteSelectionToken}
      on:close={() => (commandPaletteOpen = false)}
      on:copy={copyLastAssistantReply}
      on:execute={(event) => executePaletteCommand(event.detail.request)}
      on:prefillPrompt={(event) => {
        seedComposer(event.detail.value);
        commandPaletteOpen = false;
      }}
      on:setTheme={(event) => setTheme(event.detail.value)}
    />
  </main>
{/if}
