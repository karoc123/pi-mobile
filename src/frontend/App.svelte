<script lang="ts">
  import { onMount } from 'svelte';

  import type {
    AgentCommandRequest,
    AgentCommandResponse,
    AgentCommandState,
    AgentSnapshot,
    AgentUsage,
    BackendHealthResponse,
    BackendLogEntry,
    BackendLogLevel,
    BackendLogQueryResponse,
    CostReport,
    DiffFile,
    GitCommitResult,
    FileDocument,
    FileEntry,
    SelectedRepo,
    SessionResponse,
    WebsocketEnvelope,
    WorkspaceEntry
  } from '../shared/contracts.js';
  import AppMenu, { type ThemeName } from './components/AppMenu.svelte';
  import BottomNav, { type ViewName } from './components/BottomNav.svelte';
  import ChatView from './components/ChatView.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import CostView, { type CostRangePreset } from './components/CostView.svelte';
  import LogView from './components/LogView.svelte';
  import LoginScreen from './components/LoginScreen.svelte';
  import SystemStatusBar from './components/SystemStatusBar.svelte';
  import WorkspacePicker from './components/WorkspacePicker.svelte';
  import { ApiRequestError, apiFetch } from './lib/api.js';

  type AppViewName = ViewName | 'costs' | 'logs';
  type AsyncViewName = Exclude<ViewName, 'chat'>;
  type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
  type BackendStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown';

  const themeStorageKey = 'pimobile.theme';
  const backendHealthPollIntervalMs = 10_000;
  const logStreamRetryDelayMs = 1_500;
  const maxVisibleLogEntries = 600;

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
    isConfigured: false,
    isStreaming: false,
    messages: [],
    tools: [],
    lastError: null,
    usage: emptyUsage,
  };

  const emptyCostReport: CostReport = {
    summary: {
      totalSessions: 0,
      totalCost: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    sessions: [],
    filters: {
      repos: [],
      models: [],
    },
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
  let view: AppViewName = 'chat';

  let diffLoading = false;
  let diffFiles: DiffFile[] = [];
  let revertingHunkId: string | null = null;
  let committing = false;

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
  let socketManualClose = false;
  let socketStatus: SocketStatus = 'offline';
  let socketReconnectAttempt = 0;

  let backendStatus: BackendStatus = 'unknown';
  let backendLastSeen: string | null = null;
  let backendUptimeSeconds: number | null = null;
  let backendHealthTimer: number | null = null;

  let bannerMessage = '';
  let bannerTone: 'info' | 'success' | 'error' = 'info';
  let menuOpen = false;
  let lazyViewLoading: AsyncViewName | null = null;
  let lazyViewError = '';
  let diffViewComponent: any = null;
  let editorViewComponent: any = null;
  let diffViewPromise: Promise<void> | null = null;
  let editorViewPromise: Promise<void> | null = null;
  let theme: ThemeName = 'vscode-dark';
  let commandPaletteOpen = false;
  let commandStateLoading = false;
  let commandBusy = false;
  let commandState: AgentCommandState | null = null;
  let composerPrefill = '';
  let composerPrefillToken = 0;
  let costReport: CostReport = emptyCostReport;
  let costLoading = false;
  let costRepoFilter = '';
  let costModelFilter = '';
  let costFromDate = '';
  let costToDate = '';
  let costPreset: CostRangePreset = 'all';

  let logEntries: BackendLogEntry[] = [];
  let logLoading = false;
  let logLoadingMore = false;
  let logHasMore = false;
  let logViewError = '';
  let logLive = true;
  let logStreamConnected = false;
  let logLevelFilter: BackendLogLevel | '' = '';
  let logSourceFilter = '';
  let logSearchFilter = '';
  let logKnownSources: string[] = [];
  let logEventSource: EventSource | null = null;
  let logStreamRetryTimer: number | null = null;
  let activeLogStreamUrl = '';

  onMount(() => {
    initializeTheme();
    void initialize();

    return () => {
      closeSocket();
      stopBackendHealthPolling();
      stopLogStream();
    };
  });

  $: if (currentRepo && view === 'diff') {
    void ensureDiffViewLoaded();
  }

  $: if (currentRepo && view === 'editor') {
    void ensureEditorViewLoaded();
  }

  $: if (authenticated && view === 'logs' && logLive) {
    startLogStream();
  } else {
    stopLogStream();
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
      loginError = toErrorMessage(error);
    }
  }

  function initializeTheme() {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    if (storedTheme === 'vscode-dark' || storedTheme === 'vscode-light') {
      setTheme(storedTheme, false);
      return;
    }

    setTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'vscode-light' : 'vscode-dark', false);
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
    startBackendHealthPolling();
    await checkBackendHealth();

    try {
      agentSnapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
      currentRepo = agentSnapshot.repo ?? currentRepo;
      await loadWorkspaces('.');

      if (currentRepo) {
        await refreshCurrentRepoData();
      }
    } catch (error) {
      closeSocket();
      throw error;
    }
  }

  async function ensureDiffViewLoaded() {
    if (diffViewComponent || diffViewPromise) {
      return diffViewPromise;
    }

    lazyViewLoading = 'diff';
    lazyViewError = '';
    diffViewPromise = import('./components/DiffView.svelte')
      .then((module) => {
        diffViewComponent = module.default;
      })
      .catch((error) => {
        lazyViewError = toErrorMessage(error);
      })
      .finally(() => {
        if (lazyViewLoading === 'diff') {
          lazyViewLoading = null;
        }

        diffViewPromise = null;
      });

    return diffViewPromise;
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

      try {
        await bootstrapWorkspace();
      } catch (error) {
        resetAuthenticatedState(toErrorMessage(error));
      }
    } catch (error) {
      loginError = toErrorMessage(error);
    } finally {
      loginPending = false;
    }
  }

  async function logout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.status === 401)) {
        showBanner(toErrorMessage(error), 'error');
      }
    } finally {
      resetAuthenticatedState('');
    }
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

  function handleSocketMessage(event: WebsocketEnvelope) {
    if (event.type === 'connected') {
      agentSnapshot = event.payload;
      currentRepo = event.payload.repo;
      socketStatus = 'connected';
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
      commandPaletteOpen = false;
      commandState = null;
      agentSnapshot = {
        ...emptyAgentSnapshot,
        repo: event.payload.repo,
        isConfigured: true
      };
      selectedDocument = null;
      draftContent = '';
      editorDirty = false;
      filePath = '.';
      view = view === 'costs' || view === 'logs' ? view : 'chat';
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
      handleApiFailure(error);
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
      menuOpen = false;
      workspaceOpen = false;
      showBanner('Repository activated.', 'success');
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function refreshCurrentRepoData() {
    await Promise.all([loadDiff(), loadFiles('.'), loadAgentState()]);
  }

  async function openCostView() {
    menuOpen = false;
    view = 'costs';
    await loadCosts();
  }

  async function openLogView() {
    menuOpen = false;
    view = 'logs';
    await loadLogs(true);
  }

  async function loadCosts() {
    costLoading = true;

    try {
      const query = new URLSearchParams();

      if (costRepoFilter) {
        query.set('repo', costRepoFilter);
      }

      if (costModelFilter) {
        query.set('model', costModelFilter);
      }

      if (costFromDate) {
        query.set('from', `${costFromDate}T00:00:00.000Z`);
      }

      if (costToDate) {
        query.set('to', `${costToDate}T23:59:59.999Z`);
      }

      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      costReport = await apiFetch<CostReport>(`/api/costs${suffix}`);
    } catch (error) {
      handleApiFailure(error);
    } finally {
      costLoading = false;
    }
  }

  function updateCostRepoFilter(value: string) {
    costRepoFilter = value;
    void loadCosts();
  }

  function updateCostModelFilter(value: string) {
    costModelFilter = value;
    void loadCosts();
  }

  function updateCostFromDate(value: string) {
    costFromDate = value;
    costPreset = 'custom';
    void loadCosts();
  }

  function updateCostToDate(value: string) {
    costToDate = value;
    costPreset = 'custom';
    void loadCosts();
  }

  function applyCostPreset(preset: Exclude<CostRangePreset, 'custom'>) {
    costPreset = preset;

    if (preset === 'all') {
      costFromDate = '';
      costToDate = '';
      void loadCosts();
      return;
    }

    const end = new Date();
    const start = new Date(end);
    const dayCount = preset === '7d' ? 6 : preset === '30d' ? 29 : 89;

    start.setUTCDate(start.getUTCDate() - dayCount);
    costFromDate = start.toISOString().slice(0, 10);
    costToDate = end.toISOString().slice(0, 10);
    void loadCosts();
  }

  async function loadAgentState() {
    try {
      agentSnapshot = await apiFetch<AgentSnapshot>('/api/agent/state');
      currentRepo = agentSnapshot.repo;
    } catch (error) {
      handleApiFailure(error);
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

  async function openCommandPalette() {
    if (!currentRepo) {
      return;
    }

    commandPaletteOpen = true;
    await loadCommandState();
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
      handleApiFailure(error);
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
      handleApiFailure(error);
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
      handleApiFailure(error);
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
      handleApiFailure(error);
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
      handleApiFailure(error);
    }
  }

  async function abortRun() {
    try {
      await apiFetch('/api/agent/abort', { method: 'POST' });
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function executePaletteCommand(request: AgentCommandRequest) {
    commandBusy = true;

    try {
      const response = await apiFetch<AgentCommandResponse>('/api/agent/command', {
        method: 'POST',
        body: JSON.stringify(request)
      });

      await loadAgentState();

      if (response.prompt) {
        seedComposer(response.prompt);
      }

      if (response.message) {
        showBanner(response.message, 'success');
      }

      if (request.command === 'set-model' || request.command === 'set-thinking' || request.command === 'set-auto-compact') {
        await loadCommandState();
      } else {
        commandPaletteOpen = false;
        commandState = null;
      }
    } catch (error) {
      handleApiFailure(error);
    } finally {
      commandBusy = false;
    }
  }

  async function copyLastAssistantReply() {
    const lastAssistantReply = [...agentSnapshot.messages].reverse().find((message) => message.role === 'assistant' && message.text.trim().length > 0);

    if (!lastAssistantReply) {
      showBanner('No assistant reply to copy yet.', 'info');
      return;
    }

    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard is not available in this browser.');
      }

      await navigator.clipboard.writeText(lastAssistantReply.text);
      commandPaletteOpen = false;
      showBanner('Last assistant reply copied.', 'success');
    } catch (error) {
      handleApiFailure(error);
    }
  }

  function requestCommit(_event?: CustomEvent<void>) {
    if (committing) {
      return;
    }

    const input = window.prompt('Commit message', '');

    if (input === null) {
      return;
    }

    const trimmed = input.trim();

    if (!trimmed) {
      showBanner('Commit message is required.', 'error');
      return;
    }

    void commitChanges(trimmed);
  }

  async function commitChanges(message: string) {
    if (!currentRepo) {
      showBanner('Select a repository before committing.', 'error');
      return;
    }

    committing = true;

    try {
      const { commitSha } = await apiFetch<GitCommitResult>('/api/git/commit', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      await loadDiff();
      showBanner(`Committed ${commitSha.slice(0, 7)}.`, 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      committing = false;
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
      handleApiFailure(error);
    } finally {
      revertingHunkId = null;
    }
  }

  async function loadLogs(refresh = false) {
    if (refresh) {
      logLoading = true;
    } else {
      logLoadingMore = true;
    }

    try {
      const query = new URLSearchParams();
      query.set('limit', '200');

      if (!refresh && logEntries.length > 0) {
        query.set('beforeSeq', String(logEntries[0].seq));
      }

      if (logLevelFilter) {
        query.set('level', logLevelFilter);
      }

      if (logSourceFilter) {
        query.set('source', logSourceFilter);
      }

      if (logSearchFilter) {
        query.set('search', logSearchFilter);
      }

      const response = await apiFetch<BackendLogQueryResponse>(`/api/logs?${query.toString()}`);
      logEntries = refresh ? response.entries : mergeLogEntries(logEntries, response.entries);
      logEntries = logEntries.slice(-maxVisibleLogEntries);
      logHasMore = response.hasMore;
      logKnownSources = collectLogSources(logEntries);
      logViewError = '';
    } catch (error) {
      logViewError = toErrorMessage(error);
      handleApiFailure(error);
    } finally {
      if (refresh) {
        logLoading = false;
      } else {
        logLoadingMore = false;
      }
    }
  }

  async function loadOlderLogs() {
    if (logLoadingMore || !logHasMore) {
      return;
    }

    await loadLogs(false);
  }

  function setLogLevel(value: BackendLogLevel | '') {
    logLevelFilter = value;
    void reloadLogView();
  }

  function setLogSource(value: string) {
    logSourceFilter = value;
    void reloadLogView();
  }

  function setLogSearch(value: string) {
    logSearchFilter = value;
    void reloadLogView();
  }

  function clearLogFilters() {
    logLevelFilter = '';
    logSourceFilter = '';
    logSearchFilter = '';
    void reloadLogView();
  }

  function toggleLogLive(value: boolean) {
    logLive = value;

    if (logLive) {
      startLogStream(true);
      return;
    }

    stopLogStream();
  }

  async function reloadLogView() {
    await loadLogs(true);
    if (view === 'logs' && logLive) {
      startLogStream(true);
    }
  }

  function startLogStream(forceRestart = false) {
    if (!authenticated || view !== 'logs' || !logLive) {
      return;
    }

    const query = new URLSearchParams();

    if (logLevelFilter) {
      query.set('level', logLevelFilter);
    }

    if (logSourceFilter) {
      query.set('source', logSourceFilter);
    }

    if (logSearchFilter) {
      query.set('search', logSearchFilter);
    }

    const streamUrl = query.size > 0 ? `/api/logs/stream?${query.toString()}` : '/api/logs/stream';

    if (!forceRestart && logEventSource && activeLogStreamUrl === streamUrl) {
      return;
    }

    stopLogStream();

    const source = new EventSource(streamUrl, { withCredentials: true });
    logEventSource = source;
    activeLogStreamUrl = streamUrl;

    source.addEventListener('ready', () => {
      if (logEventSource !== source) {
        return;
      }

      logStreamConnected = true;
      logViewError = '';
    });

    source.addEventListener('log', (event) => {
      if (logEventSource !== source) {
        return;
      }

      const payload = event as MessageEvent<string>;

      try {
        const entry = JSON.parse(payload.data) as BackendLogEntry;
        logEntries = mergeLogEntries(logEntries, [entry]).slice(-maxVisibleLogEntries);
        logKnownSources = collectLogSources(logEntries);
      } catch {
        // Ignore malformed stream payloads but keep stream open.
      }
    });

    source.onerror = () => {
      if (logEventSource !== source) {
        return;
      }

      source.close();
      logEventSource = null;
      activeLogStreamUrl = '';
      logStreamConnected = false;

      if (!authenticated || view !== 'logs' || !logLive) {
        return;
      }

      if (logStreamRetryTimer === null) {
        logStreamRetryTimer = window.setTimeout(() => {
          logStreamRetryTimer = null;
          startLogStream(true);
        }, logStreamRetryDelayMs);
      }
    };
  }

  function stopLogStream() {
    if (logStreamRetryTimer !== null) {
      window.clearTimeout(logStreamRetryTimer);
      logStreamRetryTimer = null;
    }

    if (logEventSource) {
      logEventSource.close();
      logEventSource = null;
    }

    activeLogStreamUrl = '';
    logStreamConnected = false;
  }

  function startBackendHealthPolling() {
    if (backendHealthTimer !== null) {
      return;
    }

    backendHealthTimer = window.setInterval(() => {
      void checkBackendHealth();
    }, backendHealthPollIntervalMs);
  }

  function stopBackendHealthPolling() {
    if (backendHealthTimer !== null) {
      window.clearInterval(backendHealthTimer);
      backendHealthTimer = null;
    }
  }

  async function checkBackendHealth() {
    try {
      const health = await apiFetch<BackendHealthResponse>('/api/health');
      backendStatus = health.status;
      backendLastSeen = health.serverTime;
      backendUptimeSeconds = health.uptimeSeconds;
    } catch {
      backendStatus = 'unreachable';
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
    loginPending = false;
    authenticated = false;
    currentRepo = null;
    view = 'chat';
    menuOpen = false;
    commandPaletteOpen = false;
    commandState = null;
    workspaceOpen = false;
    workspaceEntries = [];
    workspacePath = '.';
    diffFiles = [];
    fileEntries = [];
    filePath = '.';
    selectedDocument = null;
    draftContent = '';
    editorDirty = false;
    agentSnapshot = emptyAgentSnapshot;
    costReport = emptyCostReport;
    costRepoFilter = '';
    costModelFilter = '';
    costFromDate = '';
    costToDate = '';
    costPreset = 'all';
    logEntries = [];
    logKnownSources = [];
    logViewError = '';
    logHasMore = false;
    stopLogStream();
    closeSocket();
    stopBackendHealthPolling();
    socketReconnectAttempt = 0;
    loginError = message;
  }

  function mergeLogEntries(current: BackendLogEntry[], incoming: BackendLogEntry[]) {
    const bySeq = new Map<number, BackendLogEntry>();

    for (const entry of current) {
      bySeq.set(entry.seq, entry);
    }

    for (const entry of incoming) {
      bySeq.set(entry.seq, entry);
    }

    return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
  }

  function collectLogSources(entries: BackendLogEntry[]) {
    return [...new Set(entries.map((entry) => entry.source).filter((source) => source.length > 0))].sort((left, right) => left.localeCompare(right));
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
    if (error instanceof ApiRequestError) {
      const requestHint = error.requestId ? ` (request ${error.requestId})` : '';
      return `${error.message}${requestHint}`;
    }

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
    <button
      class="menu-trigger"
      type="button"
      aria-expanded={menuOpen}
      aria-label={menuOpen ? 'Close workspace menu' : 'Open workspace menu'}
      on:click={() => (menuOpen = !menuOpen)}
    >
      Menu
    </button>

    {#if bannerMessage}
      <div class:success={bannerTone === 'success'} class:error={bannerTone === 'error'} class="notice floating">{bannerMessage}</div>
    {/if}

    <SystemStatusBar
      authStatus="authenticated"
      socketStatus={socketStatus}
      reconnectAttempt={socketReconnectAttempt}
      backendStatus={backendStatus}
      backendLastSeen={backendLastSeen}
      backendUptimeSeconds={backendUptimeSeconds}
      logStreamLive={view === 'logs' && logLive && logStreamConnected}
    />

    {#if view === 'costs'}
      <CostView
        report={costReport}
        loading={costLoading}
        selectedRepo={costRepoFilter}
        selectedModel={costModelFilter}
        fromDate={costFromDate}
        toDate={costToDate}
        selectedPreset={costPreset}
        on:refresh={() => void loadCosts()}
        on:setRepo={(event) => updateCostRepoFilter(event.detail.value)}
        on:setModel={(event) => updateCostModelFilter(event.detail.value)}
        on:setFrom={(event) => updateCostFromDate(event.detail.value)}
        on:setTo={(event) => updateCostToDate(event.detail.value)}
        on:applyPreset={(event) => applyCostPreset(event.detail.value)}
      />
    {:else if view === 'logs'}
      <LogView
        entries={logEntries}
        loading={logLoading}
        loadingMore={logLoadingMore}
        hasMore={logHasMore}
        live={logLive}
        streamConnected={logStreamConnected}
        levelFilter={logLevelFilter}
        sourceFilter={logSourceFilter}
        searchFilter={logSearchFilter}
        knownSources={logKnownSources}
        lastError={logViewError}
        on:refresh={() => void loadLogs(true)}
        on:loadMore={() => void loadOlderLogs()}
        on:toggleLive={(event) => toggleLogLive(event.detail.value)}
        on:setLevel={(event) => setLogLevel(event.detail.value)}
        on:setSource={(event) => setLogSource(event.detail.value)}
        on:setSearch={(event) => setLogSearch(event.detail.value)}
        on:clearFilters={clearLogFilters}
      />
    {:else if currentRepo}
      {#if view === 'chat'}
        <ChatView
          messages={agentSnapshot.messages}
          tools={agentSnapshot.tools}
          isStreaming={agentSnapshot.isStreaming}
          lastError={agentSnapshot.lastError}
          usage={agentSnapshot.usage}
          prefillPrompt={composerPrefill}
          prefillToken={composerPrefillToken}
          on:submit={(event) => sendPrompt(event.detail.prompt)}
          on:abort={abortRun}
          on:openCommands={() => void openCommandPalette()}
        />
      {:else if view === 'diff'}
        {#if diffViewComponent}
          <svelte:component
            this={diffViewComponent}
            files={diffFiles}
            loading={diffLoading}
            revertingHunkId={revertingHunkId}
            committing={committing}
            on:commit={requestCommit}
            on:revert={(event) => revertHunk(event.detail.diff, event.detail.hunkId)}
          />
        {:else if lazyViewLoading === 'diff'}
          <section class="view-shell">
            <div class="empty-state-card compact">
              <h2>Loading diff tools...</h2>
              <p>Diff2Html is being loaded only when you open this view.</p>
            </div>
          </section>
        {:else}
          <section class="view-shell">
            <div class="empty-state-card compact">
              <h2>Could not load diff view</h2>
              <p>{lazyViewError || 'Unexpected lazy-load error.'}</p>
            </div>
          </section>
        {/if}
      {:else}
        {#if editorViewComponent}
          <svelte:component
            this={editorViewComponent}
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
          <p>Open the repository picker and choose any Git repository below the configured WORKSPACE_ROOT.</p>
          <button class="primary-button" type="button" on:click={() => (workspaceOpen = true)}>Open picker</button>
        </div>
      </section>
    {/if}

    <BottomNav currentView={view === 'costs' || view === 'logs' ? 'chat' : view} disabled={!currentRepo} on:navigate={(event) => (view = event.detail.view)} />
    <AppMenu
      open={menuOpen}
      currentRepo={currentRepo}
      theme={theme}
      on:close={() => (menuOpen = false)}
      on:chooseRepo={() => {
        menuOpen = false;
        workspaceOpen = true;
      }}
      on:openCosts={() => void openCostView()}
      on:openLogs={() => void openLogView()}
      on:setTheme={(event) => setTheme(event.detail.value)}
      on:logout={logout}
    />
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
    <CommandPalette
      open={commandPaletteOpen}
      loading={commandStateLoading}
      busy={commandBusy}
      state={commandState}
      theme={theme}
      on:close={() => (commandPaletteOpen = false)}
      on:copy={copyLastAssistantReply}
      on:execute={(event) => executePaletteCommand(event.detail.request)}
      on:setTheme={(event) => setTheme(event.detail.value)}
    />
  </main>
{/if}