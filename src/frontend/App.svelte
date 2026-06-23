<script lang="ts">
  import { onMount } from 'svelte';

  import type {
    AgentCommandRequest,
    AgentCommandResponse,
    AgentCommandState,
    AgentSnapshot,
    AgentUsage,
    ChatMessage,
    InteractivePrompt,
    ToolActivity,
    BackendHealthResponse,
    BackendResourceCheck,
    BackendLogEntry,
    BackendLogLevel,
    BackendLogQueryResponse,
    CostReport,
    DiffFile,
    GitCommitResult,
    FileCreateDirectoryResult,
    FileCreateResult,
    FileDeleteResult,
    FileDocument,
    FileDownloadInfo,
    FileDuplicateResult,
    FileEntry,
    FileMoveResult,
    FileUploadResult,
    GitDiffResponse,
    GitRemoteSyncStatus,
    GitSyncResult,
    PiAuthLoginTokenResponse,
    PiAuthProviderState,
    PiAuthStatusResponse,
    SelectedRepo,
    SessionResponse,
    WebsocketEnvelope,
    WorkspaceCloneResult,
    WorkspaceEntry
  } from '../shared/contracts.js';
  import AppMenu from './components/AppMenu.svelte';
  import BottomNav from './components/BottomNav.svelte';
  import ChatView from './components/ChatView.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import CostView from './components/CostView.svelte';
  import LogView from './components/LogView.svelte';
  import LoginScreen from './components/LoginScreen.svelte';
  import PiLoginModal from './components/PiLoginModal.svelte';
  import SystemStatusBar from './components/SystemStatusBar.svelte';
  import WorkspacePicker from './components/WorkspacePicker.svelte';
  import { ApiRequestError, apiFetch } from './lib/api.js';

  type ThemeName = 'vscode-dark' | 'vscode-light';
  type ViewName = 'chat' | 'diff' | 'editor';
  type CostRangePreset = '7d' | '30d' | '90d' | 'all' | 'custom';
  type AppViewName = ViewName | 'costs' | 'logs';
  type AsyncViewName = Exclude<ViewName, 'chat'>;
  type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
  type BackendStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown';
  type ToolTraceBatch = {
    id: string;
    boundary: number;
    tools: ToolActivity[];
  };

  const themeStorageKey = 'pimobile.theme';
  const backendHealthPollIntervalMs = 10_000;
  const agentStatePollIntervalMs = 7_000;
  const socketStateResyncDelaysMs = [300, 1200, 3000, 7000, 12000] as const;
  const diffRefreshDebounceMs = 450;
  const logStreamRetryDelayMs = 1_500;
  const maxVisibleLogEntries = 600;
  const maxToolBatchCount = 8;
  const maxToolsPerBatch = 24;
  const maxLocalSystemMessages = 40;
  const followUpCostGuardEnabledStorageKey = 'pimobile.follow-up-cost-guard-enabled';
  const followUpCostSoftLimitUsdStorageKey = 'pimobile.follow-up-cost-soft-limit-usd';
  const defaultFollowUpCostGuardEnabled = resolveFollowUpCostGuardEnabled();
  const defaultFollowUpCostSoftLimitUsd = resolveFollowUpCostSoftLimitUsdFromEnv();

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
  let workspaceCloning = false;
  let workspacePath = '.';
  let workspaceEntries: WorkspaceEntry[] = [];
  let currentRepo: SelectedRepo | null = null;
  let view: AppViewName = 'chat';

  let diffLoading = false;
  let diffFiles: DiffFile[] = [];
  let diffSyncStatus: GitRemoteSyncStatus | null = null;
  let diffRefreshPending = false;
  let diffReloadTimer: number | null = null;
  let revertingHunkId: string | null = null;
  let stagingHunkId: string | null = null;
  let unstagingHunkId: string | null = null;
  let stagingAll = false;
  let unstagingAll = false;
  let committing = false;
  let pulling = false;
  let pushing = false;

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
  let followUpCostGuardEnabled = defaultFollowUpCostGuardEnabled;
  let followUpCostGuardEnabledHasOverride = false;
  let followUpCostSoftLimitUsd = defaultFollowUpCostSoftLimitUsd;
  let followUpCostSoftLimitHasOverride = false;
  let keepRunningRequired = false;
  let keepRunningApproved = false;
  let lastKnownGlobalCostUsd = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let socketManualClose = false;
  let socketStatus: SocketStatus = 'offline';
  let socketReconnectAttempt = 0;
  let socketStateResyncTimer: number | null = null;
  let socketStateResyncDelayIndex = 0;

  let backendStatus: BackendStatus = 'unknown';
  let backendLastSeen: string | null = null;
  let backendUptimeSeconds: number | null = null;
  let backendResourceChecks: BackendResourceCheck[] = [];
  let backendResourcesAccessible = false;
  let backendHealthTimer: number | null = null;
  let agentStatePollTimer: number | null = null;

  let bannerMessage = '';
  let bannerTone: 'info' | 'success' | 'error' = 'info';
  let menuOpen = false;
  let piLoginOpen = false;
  let piAuthProviders: PiAuthProviderState[] = [];
  let piAuthLoading = false;
  let piAuthSubmitting = false;
  let piAuthError = '';
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
  let commandPaletteInitialCommand: string | null = null;
  let commandPaletteSelectionToken = 0;
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
  let clearingLogs = false;

  let systemStatusVisible = false;

  onMount(() => {
    initializeTheme();
    initializeFollowUpCostGuardSettings();
    void initialize();

    return () => {
      stopAgentStatePolling();
      closeSocket();
      stopBackendHealthPolling();
      stopLogStream();

      if (diffReloadTimer !== null) {
        window.clearTimeout(diffReloadTimer);
        diffReloadTimer = null;
      }
    };
  });

  $: if (currentRepo && view === 'diff') {
    void ensureDiffViewLoaded();
  }

  $: if (currentRepo && view === 'diff' && diffRefreshPending) {
    scheduleDiffReload();
  }

  $: if (currentRepo && view === 'editor') {
    void ensureEditorViewLoaded();
  }

  $: chatMessages = [...agentSnapshot.messages, ...localSystemMessages];

  $: if (agentSnapshot.runtimePhase === 'idle' && (keepRunningRequired || keepRunningApproved)) {
    keepRunningRequired = false;
    keepRunningApproved = false;
  }

  $: {
    const unresolvedUsageCost =
      agentSnapshot.usage.totalCost === 0 &&
      agentSnapshot.usage.totalTokens > 0 &&
      !agentSnapshot.usage.usingSubscription;

    const shouldPollAgentState =
      authenticated &&
      !!currentRepo &&
      (socketStatus !== 'connected' || agentSnapshot.runtimePhase !== 'idle' || unresolvedUsageCost);

    if (shouldPollAgentState) {
      startAgentStatePolling();
    } else {
      stopAgentStatePolling();
    }
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

  function initializeFollowUpCostGuardSettings() {
    const storedGuardEnabled = window.localStorage.getItem(followUpCostGuardEnabledStorageKey);

    if (storedGuardEnabled !== null) {
      const parsed = parseStoredBoolean(storedGuardEnabled);

      if (parsed !== null) {
        followUpCostGuardEnabled = parsed;
        followUpCostGuardEnabledHasOverride = true;
      } else {
        window.localStorage.removeItem(followUpCostGuardEnabledStorageKey);
      }
    }

    const storedSoftLimitUsd = window.localStorage.getItem(followUpCostSoftLimitUsdStorageKey);

    if (storedSoftLimitUsd !== null) {
      const parsed = parseNonNegativeNumber(storedSoftLimitUsd);

      if (parsed !== null) {
        followUpCostSoftLimitUsd = parsed;
        followUpCostSoftLimitHasOverride = true;
      } else {
        window.localStorage.removeItem(followUpCostSoftLimitUsdStorageKey);
      }
    }
  }

  function setFollowUpCostGuardEnabled(value: boolean) {
    followUpCostGuardEnabled = value;
    followUpCostGuardEnabledHasOverride = true;
    window.localStorage.setItem(followUpCostGuardEnabledStorageKey, value ? 'true' : 'false');
    clearKeepRunningGate();
  }

  function resetFollowUpCostGuardEnabled() {
    followUpCostGuardEnabled = defaultFollowUpCostGuardEnabled;
    followUpCostGuardEnabledHasOverride = false;
    window.localStorage.removeItem(followUpCostGuardEnabledStorageKey);
    clearKeepRunningGate();
  }

  function setFollowUpCostSoftLimitUsd(valueRaw: string) {
    const parsed = parseNonNegativeNumber(valueRaw);

    if (parsed === null) {
      showBanner('Soft limit must be a non-negative number.', 'error');
      return;
    }

    const normalized = Number(parsed.toFixed(2));
    followUpCostSoftLimitUsd = normalized;
    followUpCostSoftLimitHasOverride = true;
    window.localStorage.setItem(followUpCostSoftLimitUsdStorageKey, normalized.toFixed(2));
    clearKeepRunningGate();
  }

  function resetFollowUpCostSoftLimitUsd() {
    followUpCostSoftLimitUsd = defaultFollowUpCostSoftLimitUsd;
    followUpCostSoftLimitHasOverride = false;
    window.localStorage.removeItem(followUpCostSoftLimitUsdStorageKey);
    clearKeepRunningGate();
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

  async function openPiLogin() {
    piLoginOpen = true;
    await loadPiAuthStatus();
  }

  async function loadPiAuthStatus() {
    piAuthLoading = true;
    piAuthError = '';

    try {
      const response = await apiFetch<PiAuthStatusResponse>('/api/pi/auth/status');
      piAuthProviders = response.providers;
    } catch (error) {
      piAuthError = toErrorMessage(error);
    } finally {
      piAuthLoading = false;
    }
  }

  async function loginPiToken(provider: string, token: string) {
    piAuthSubmitting = true;
    piAuthError = '';

    try {
      const response = await apiFetch<PiAuthLoginTokenResponse>('/api/pi/auth/login-token', {
        method: 'POST',
        body: JSON.stringify({ provider, token })
      });

      showBanner(`Pi token for ${response.provider} saved.`, 'success');
      await loadPiAuthStatus();
    } catch (error) {
      const message = toErrorMessage(error);
      piAuthError = message;
      showBanner(message, 'error');
    } finally {
      piAuthSubmitting = false;
    }
  }

  async function logoutPiProvider(provider: string) {
    piAuthSubmitting = true;
    piAuthError = '';

    try {
      await apiFetch('/api/pi/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ provider })
      });

      showBanner(`Pi auth for ${provider} removed.`, 'success');
      await loadPiAuthStatus();
    } catch (error) {
      const message = toErrorMessage(error);
      piAuthError = message;
      showBanner(message, 'error');
    } finally {
      piAuthSubmitting = false;
    }
  }

  function connectSocket() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    clearSocketStateResyncTimer();

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

      clearSocketStateResyncTimer();
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
    clearSocketStateResyncTimer();

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

  function clearSocketStateResyncTimer() {
    if (socketStateResyncTimer !== null) {
      window.clearTimeout(socketStateResyncTimer);
      socketStateResyncTimer = null;
    }

    socketStateResyncDelayIndex = 0;
  }

  function scheduleSocketStateResyncBurst() {
    clearSocketStateResyncTimer();
    scheduleNextSocketStateResync();
  }

  function scheduleNextSocketStateResync() {
    if (socketStateResyncDelayIndex >= socketStateResyncDelaysMs.length) {
      return;
    }

    const delayMs = socketStateResyncDelaysMs[socketStateResyncDelayIndex];
    socketStateResyncDelayIndex += 1;

    socketStateResyncTimer = window.setTimeout(() => {
      socketStateResyncTimer = null;

      if (!authenticated || !currentRepo) {
        return;
      }

      void loadAgentState({ silent: true }).finally(() => {
        scheduleNextSocketStateResync();
      });
    }, delayMs);
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
      tools: [tool, ...activeBatch.tools.filter((entry) => entry.id !== tool.id)].slice(0, maxToolsPerBatch),
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
    if (event.type === 'connected') {
      const mergedUsage = coalesceUsageCost(event.payload.usage, agentSnapshot.usage);

      agentSnapshot = {
        ...event.payload,
        usage: mergedUsage,
        interactivePrompt: event.payload.interactivePrompt ?? null,
      };
      currentRepo = event.payload.repo;
      syncToolTraceFromSnapshot(event.payload);
      socketStatus = 'connected';
      scheduleSocketStateResyncBurst();
      return;
    }

    if (event.type === 'agent_status') {
      const mergedUsage = coalesceUsageCost(event.payload.usage, agentSnapshot.usage);
      const interactivePrompt = event.payload.interactivePrompt ?? agentSnapshot.interactivePrompt;

      agentSnapshot = {
        ...agentSnapshot,
        ...event.payload,
        usage: mergedUsage,
        repo: event.payload.repo ?? agentSnapshot.repo,
        interactivePrompt,
      };
      currentRepo = event.payload.repo ?? currentRepo;

      if (agentSnapshot.usage.totalCost === 0 && agentSnapshot.usage.totalTokens > 0) {
        scheduleSocketStateResyncBurst();
      }

      return;
    }

    if (event.type === 'chat_message_added') {
      agentSnapshot = {
        ...agentSnapshot,
        messages: [...agentSnapshot.messages, event.payload.message]
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
      appendToolTrace(event.payload.tool);
      return;
    }

    if (event.type === 'workspace_changed') {
      scheduleDiffReload();
      if (selectedDocument && !editorDirty && selectedDocument.path === event.payload.path) {
        void openFile(selectedDocument.path);
      }
      return;
    }

    if (event.type === 'interactive_prompt') {
      // Nur anzeigen, wenn Agent idle ist (sonst überschreibt seine
      // Antwort auf unseren Submit die gerade beantwortete Karte)
      if (agentSnapshot.runtimePhase === 'idle') {
        dismissedPromptId = null;
        agentSnapshot = {
          ...agentSnapshot,
          interactivePrompt: event.payload,
        };
      }
      return;
    }

    if (event.type === 'repo_selected') {
      currentRepo = event.payload.repo;
      workspaceCloning = false;
      commandPaletteOpen = false;
      commandState = null;
      resetToolTraceBatches();
      localSystemMessages = [];
      clearKeepRunningGate();
      agentSnapshot = {
        ...emptyAgentSnapshot,
        repo: event.payload.repo,
        isConfigured: true
      };
      selectedDocument = null;
      draftContent = '';
      editorDirty = false;
      diffRefreshPending = false;
      stagingHunkId = null;
      unstagingHunkId = null;
      stagingAll = false;
      unstagingAll = false;
      revertingHunkId = null;
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

  async function cloneRepo(remoteUrl: string, destinationPath?: string) {
    const normalizedRemoteUrl = remoteUrl.trim();
    const normalizedDestinationPath = destinationPath?.trim();

    if (!normalizedRemoteUrl) {
      showBanner('Remote URL is required.', 'error');
      return;
    }

    workspaceCloning = true;

    try {
      const response = await apiFetch<WorkspaceCloneResult>('/api/workspaces/clone', {
        method: 'POST',
        body: JSON.stringify({
          remoteUrl: normalizedRemoteUrl,
          destinationPath: normalizedDestinationPath && normalizedDestinationPath.length > 0 ? normalizedDestinationPath : undefined,
        })
      });

      currentRepo = response.repo;
      menuOpen = false;
      workspaceOpen = false;
      await loadWorkspaces(workspacePath);
      showBanner(`Repository cloned and activated (${response.repo.name}).`, 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      workspaceCloning = false;
    }
  }

  async function refreshCurrentRepoData() {
    await Promise.all([loadDiff(), loadFiles('.'), loadAgentState(), loadCommandState()]);
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
    clearKeepRunningGate();
    await executePaletteCommand({ command: 'new-session' });
  }

  function scheduleDiffReload(force = false) {
    if (!currentRepo) {
      return;
    }

    if (!force && view !== 'diff') {
      diffRefreshPending = true;
      return;
    }

    diffRefreshPending = false;

    if (diffReloadTimer !== null) {
      window.clearTimeout(diffReloadTimer);
    }

    diffReloadTimer = window.setTimeout(() => {
      diffReloadTimer = null;
      void loadDiff();
    }, diffRefreshDebounceMs);
  }

  async function loadDiff() {
    if (!currentRepo) {
      diffFiles = [];
      diffSyncStatus = null;
      diffRefreshPending = false;
      return;
    }

    diffLoading = true;

    try {
      const response = await apiFetch<GitDiffResponse>('/api/git/diff');
      diffFiles = response.files;
      diffSyncStatus = response.sync;
      diffRefreshPending = false;
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
      const document = await apiFetch<FileDocument>(`/api/files/content?path=${encodeURIComponent(path)}`);

      if (document.kind === 'binary' && document.binaryContentBase64) {
        // Binary files (e.g. .apk, .zip) werden direkt runtergeladen
        const mimeType = document.mimeType || 'application/octet-stream';
        const byteString = atob(document.binaryContentBase64);
        const byteArrays: Uint8Array[] = [];

        for (let offset = 0; offset < byteString.length; offset += 512) {
          const chunk = byteString.slice(offset, offset + 512);
          const bytes = new Uint8Array(chunk.length);

          for (let index = 0; index < chunk.length; index++) {
            bytes[index] = chunk.charCodeAt(index);
          }

          byteArrays.push(bytes);
        }

        const blob = new Blob(byteArrays, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);

        const anchor = document.createElement('a');
        anchor.href = blobUrl;
        anchor.download = document.path.split('/').pop() || 'download';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(blobUrl);

        showBanner('Binary file downloaded.', 'success');
        return;
      }

      selectedDocument = document;
      draftContent = selectedDocument.kind === 'text' ? selectedDocument.content : '';
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

  async function createFile(path: string, content: string) {
    const normalizedPath = path.trim();

    if (!normalizedPath || normalizedPath === '.') {
      showBanner('File path is required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileCreateResult>('/api/files/create', {
        method: 'POST',
        body: JSON.stringify({ path: normalizedPath, content })
      });
      await loadFiles(parentDirectoryFor(response.path));
      await openFile(response.path);
      showBanner('File created.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function createDirectory(path: string) {
    const normalizedPath = path.trim();

    if (!normalizedPath || normalizedPath === '.') {
      showBanner('Directory path is required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileCreateDirectoryResult>('/api/files/create-directory', {
        method: 'POST',
        body: JSON.stringify({ path: normalizedPath })
      });
      await loadFiles(parentDirectoryFor(response.path));
      showBanner('Folder created.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function duplicateFile(sourcePath: string, targetPath: string) {
    const normalizedSourcePath = sourcePath.trim();
    const normalizedTargetPath = targetPath.trim();

    if (!normalizedSourcePath || !normalizedTargetPath || normalizedSourcePath === '.' || normalizedTargetPath === '.') {
      showBanner('Source and target file paths are required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileDuplicateResult>('/api/files/duplicate', {
        method: 'POST',
        body: JSON.stringify({ sourcePath: normalizedSourcePath, targetPath: normalizedTargetPath })
      });
      await loadFiles(parentDirectoryFor(response.path));
      await openFile(response.path);
      showBanner('File duplicated.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function renameFile(fromPath: string, toPath: string) {
    const normalizedFromPath = fromPath.trim();
    const normalizedToPath = toPath.trim();

    if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === '.' || normalizedToPath === '.') {
      showBanner('Source and target file paths are required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileMoveResult>('/api/files/rename', {
        method: 'POST',
        body: JSON.stringify({ fromPath: normalizedFromPath, toPath: normalizedToPath })
      });
      await loadFiles(parentDirectoryFor(response.toPath));
      await openFile(response.toPath);
      showBanner('File renamed.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function moveFile(fromPath: string, toPath: string) {
    const normalizedFromPath = fromPath.trim();
    const normalizedToPath = toPath.trim();

    if (!normalizedFromPath || !normalizedToPath || normalizedFromPath === '.' || normalizedToPath === '.') {
      showBanner('Source and target file paths are required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileMoveResult>('/api/files/move', {
        method: 'POST',
        body: JSON.stringify({ fromPath: normalizedFromPath, toPath: normalizedToPath })
      });
      await loadFiles(parentDirectoryFor(response.toPath));
      await openFile(response.toPath);
      showBanner('File moved.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function uploadFile(targetPath: string, contentBase64: string) {
    const normalizedPath = targetPath.trim();

    if (!normalizedPath || normalizedPath === '.') {
      showBanner('File path is required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileUploadResult>('/api/files/upload', {
        method: 'POST',
        body: JSON.stringify({ path: normalizedPath, contentBase64 })
      });
      await loadFiles(parentDirectoryFor(response.path));
      await openFile(response.path);
      showBanner('File uploaded.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  async function downloadFile(filePathToDownload: string) {
    const normalizedPath = filePathToDownload.trim();

    if (!normalizedPath || normalizedPath === '.') {
      showBanner('File path is required.', 'error');
      return;
    }

    try {
      const info = await apiFetch<FileDownloadInfo>(`/api/files/download?path=${encodeURIComponent(normalizedPath)}`);

      if (!info.contentBase64) {
        showBanner('Download failed: no content received.', 'error');
        return;
      }

      const mimeType = info.mimeType || 'application/octet-stream';
      const byteString = atob(info.contentBase64);
      const byteArrays: Uint8Array[] = [];

      for (let offset = 0; offset < byteString.length; offset += 512) {
        const chunk = byteString.slice(offset, offset + 512);
        const bytes = new Uint8Array(chunk.length);

        for (let index = 0; index < chunk.length; index++) {
          bytes[index] = chunk.charCodeAt(index);
        }

        byteArrays.push(bytes);
      }

      const blob = new Blob(byteArrays, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = info.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);

      showBanner('File downloaded.', 'success');
    } catch (error) {
      handleApiFailure(error);
    }
  }

  async function deleteFile(path: string) {
    const normalizedPath = path.trim();

    if (!normalizedPath || normalizedPath === '.') {
      showBanner('File path is required.', 'error');
      return;
    }

    creatingFile = true;

    try {
      const response = await apiFetch<FileDeleteResult>('/api/files/delete', {
        method: 'POST',
        body: JSON.stringify({ path: normalizedPath })
      });
      await loadFiles(parentDirectoryFor(response.path));

      if (selectedDocument?.path === response.path) {
        selectedDocument = null;
        draftContent = '';
        editorDirty = false;
      }

      showBanner('File deleted.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      creatingFile = false;
    }
  }

  /** Prüft ob ein InteractivePrompt angezeigt werden soll (nicht dismissed). */
  function handleGlobalSubmit(prompt: string) {
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

    const isFollowUp = agentSnapshot.runtimePhase !== 'idle';
    let globalCostTotal = lastKnownGlobalCostUsd;
    let consumedKeepRunningApproval = false;

    if (isFollowUp && followUpCostGuardEnabled) {
      globalCostTotal = await readGlobalCostTotal();
    }

    if (isFollowUp && followUpCostGuardEnabled && globalCostTotal >= followUpCostSoftLimitUsd && !keepRunningApproved) {
      keepRunningRequired = true;
      appendLocalSystemMessage(
        `Global cost currently ${formatUsd(globalCostTotal)} (limit ${formatUsd(followUpCostSoftLimitUsd)}). Tap Keep running before the next follow-up step.`,
      );
      seedComposer(trimmed);
      return;
    }

    if (!isFollowUp) {
      clearKeepRunningGate();
    } else if (keepRunningApproved) {
      consumedKeepRunningApproval = true;
      keepRunningApproved = false;
      keepRunningRequired = false;
    }

    try {
      await apiFetch('/api/agent/prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: trimmed })
      });
    } catch (error) {
      if (consumedKeepRunningApproval) {
        keepRunningApproved = true;
      }

      seedComposer(trimmed);
      handleApiFailure(error);
    }
  }

  function allowKeepRunning() {
    keepRunningRequired = false;
    keepRunningApproved = true;
    appendLocalSystemMessage(`Keep running confirmed. Next follow-up is allowed (global cost: ${formatUsd(lastKnownGlobalCostUsd)}).`);
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
          clearKeepRunningGate();
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

  async function pullChanges() {
    if (!currentRepo) {
      showBanner('Select a repository before pulling.', 'error');
      return;
    }

    pulling = true;

    try {
      const response = await apiFetch<GitSyncResult>('/api/git/pull', {
        method: 'POST'
      });
      await loadDiff();
      showBanner(response.summary || 'Pull completed.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      pulling = false;
    }
  }

  async function pushChanges() {
    if (!currentRepo) {
      showBanner('Select a repository before pushing.', 'error');
      return;
    }

    pushing = true;

    try {
      const response = await apiFetch<GitSyncResult>('/api/git/push', {
        method: 'POST'
      });
      await loadDiff();
      showBanner(response.summary || 'Push completed.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      pushing = false;
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

  async function stageHunk(diff: string, hunkId: string) {
    stagingHunkId = hunkId;

    try {
      await apiFetch('/api/git/stage-hunk', {
        method: 'POST',
        body: JSON.stringify({ diff })
      });
      await loadDiff();
      showBanner('Hunk staged.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      stagingHunkId = null;
    }
  }

  async function unstageHunk(diff: string, hunkId: string) {
    unstagingHunkId = hunkId;

    try {
      await apiFetch('/api/git/unstage-hunk', {
        method: 'POST',
        body: JSON.stringify({ diff })
      });
      await loadDiff();
      showBanner('Hunk unstaged.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      unstagingHunkId = null;
    }
  }

  async function stageAllChanges() {
    if (!currentRepo) {
      showBanner('Select a repository before staging.', 'error');
      return;
    }

    stagingAll = true;

    try {
      await apiFetch('/api/git/stage-all', {
        method: 'POST'
      });
      await loadDiff();
      showBanner('All changes staged.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      stagingAll = false;
    }
  }

  async function unstageAllChanges() {
    if (!currentRepo) {
      showBanner('Select a repository before unstaging.', 'error');
      return;
    }

    unstagingAll = true;

    try {
      await apiFetch('/api/git/unstage-all', {
        method: 'POST'
      });
      await loadDiff();
      showBanner('All changes unstaged.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      unstagingAll = false;
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

  async function clearAllLogs() {
    if (clearingLogs) {
      return;
    }

    if (!window.confirm('Delete in-memory and persisted backend logs?')) {
      return;
    }

    clearingLogs = true;

    try {
      await apiFetch('/api/logs', {
        method: 'DELETE'
      });
      logEntries = [];
      logKnownSources = [];
      logHasMore = false;
      logViewError = '';
      await loadLogs(true);
      showBanner('Backend log deleted.', 'success');
    } catch (error) {
      handleApiFailure(error);
    } finally {
      clearingLogs = false;
    }
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

  async function checkBackendHealth() {
    try {
      const health = await apiFetch<BackendHealthResponse>('/api/health');
      backendStatus = health.status;
      backendLastSeen = health.serverTime;
      backendUptimeSeconds = health.uptimeSeconds;
      backendResourceChecks = health.resources.checks;
      backendResourcesAccessible = health.resources.allRequiredAccessible;
    } catch {
      backendStatus = 'unreachable';
      backendResourceChecks = [];
      backendResourcesAccessible = false;
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
    workspaceCloning = false;
    workspaceEntries = [];
    workspacePath = '.';
    diffFiles = [];
    diffSyncStatus = null;
    diffRefreshPending = false;
    revertingHunkId = null;
    stagingHunkId = null;
    unstagingHunkId = null;
    stagingAll = false;
    unstagingAll = false;

    if (diffReloadTimer !== null) {
      window.clearTimeout(diffReloadTimer);
      diffReloadTimer = null;
    }

    fileEntries = [];
    filePath = '.';
    selectedDocument = null;
    draftContent = '';
    editorDirty = false;
    agentSnapshot = emptyAgentSnapshot;
    resetToolTraceBatches();
    localSystemMessages = [];
    chatMessages = [];
    clearKeepRunningGate();
    dismissedPromptId = null;
    lastKnownGlobalCostUsd = 0;
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
    stopAgentStatePolling();
    socketReconnectAttempt = 0;
    backendResourceChecks = [];
    backendResourcesAccessible = false;
    loginError = message;
  }

  function parentDirectoryFor(relativePath: string) {
    if (relativePath === '.' || relativePath.length === 0) {
      return '.';
    }

    const segments = relativePath.split('/').filter(Boolean);
    segments.pop();
    return segments.length === 0 ? '.' : segments.join('/');
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

  function createSystemMessageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `system-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function appendLocalSystemMessage(text: string) {
    const systemMessage: ChatMessage = {
      id: createSystemMessageId(),
      role: 'system',
      text,
      status: 'complete',
      timestamp: new Date().toISOString(),
    };

    localSystemMessages = [
      ...localSystemMessages,
      systemMessage,
    ].slice(-maxLocalSystemMessages);
  }

  function clearKeepRunningGate() {
    keepRunningRequired = false;
    keepRunningApproved = false;
  }

  function formatUsd(value: number) {
    return `$${value.toFixed(2)}`;
  }

  function parseStoredBoolean(value: string) {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }

    return null;
  }

  function parseNonNegativeNumber(value: string) {
    const parsed = Number.parseFloat(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  function coalesceUsageCost(nextUsage: AgentUsage, previousUsage: AgentUsage) {
    if (nextUsage.totalCost === 0 && nextUsage.totalTokens > 0 && previousUsage.totalCost > 0) {
      return {
        ...nextUsage,
        totalCost: previousUsage.totalCost,
      };
    }

    return nextUsage;
  }

  function resolveFollowUpCostGuardEnabled() {
    const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_FOLLOW_UP_COST_GUARD_ENABLED;

    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return true;
    }

    const parsed = parseStoredBoolean(raw);
    return parsed ?? true;
  }

  function resolveFollowUpCostSoftLimitUsdFromEnv() {
    const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_FOLLOW_UP_COST_SOFT_LIMIT_USD;

    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return 0.5;
    }

    const parsed = parseNonNegativeNumber(raw);
    return parsed ?? 0.5;
  }

  async function readGlobalCostTotal() {
    try {
      const report = await apiFetch<CostReport>('/api/costs');
      lastKnownGlobalCostUsd = report.summary.totalCost;
      return report.summary.totalCost;
    } catch {
      lastKnownGlobalCostUsd = agentSnapshot.usage.totalCost;
      return lastKnownGlobalCostUsd;
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
      <div class:success={bannerTone === 'success'} class:error={bannerTone === 'error'} class="notice floating">{bannerMessage}</div>
    {/if}

    {#if systemStatusVisible}
      <SystemStatusBar
        authStatus="authenticated"
        socketStatus={socketStatus}
        reconnectAttempt={socketReconnectAttempt}
        backendStatus={backendStatus}
        backendLastSeen={backendLastSeen}
        backendUptimeSeconds={backendUptimeSeconds}
        logStreamLive={view === 'logs' && logLive && logStreamConnected}
        resourcesAccessible={backendResourcesAccessible}
        resourceChecks={backendResourceChecks}
      />
    {/if}

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
        clearing={clearingLogs}
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
        on:clearAll={() => void clearAllLogs()}
        on:toggleLive={(event) => toggleLogLive(event.detail.value)}
        on:setLevel={(event) => setLogLevel(event.detail.value)}
        on:setSource={(event) => setLogSource(event.detail.value)}
        on:setSearch={(event) => setLogSearch(event.detail.value)}
        on:clearFilters={clearLogFilters}
      />
    {:else if currentRepo}
      {#if view === 'chat'}
        <ChatView
          messages={chatMessages}
          toolBatches={toolTraceBatches}
          runtimePhase={agentSnapshot.runtimePhase}
          pendingMessageCount={agentSnapshot.pendingMessageCount}
          canAbort={agentSnapshot.runtimePhase !== 'idle'}
          showKeepRunning={keepRunningRequired}
          lastError={agentSnapshot.lastError}
          usage={agentSnapshot.usage}
          prefillPrompt={composerPrefill}
          prefillToken={composerPrefillToken}
          availableCommands={commandState?.availableCommands ?? []}
          draftStorageScope={currentRepo.relativePath || currentRepo.absolutePath}
          interactivePrompt={agentSnapshot.interactivePrompt}
          on:submit={(event) => handleGlobalSubmit(event.detail.prompt)}
          on:abort={abortRun}
          on:keepRunning={allowKeepRunning}
          on:newSession={() => void startNewChatFromComposer()}
          on:openCommands={() => void openCommandPalette()}
          on:openModelCommands={() => void openCommandPalette('/model')}
          on:interactiveDismiss={() => {
            agentSnapshot = { ...agentSnapshot, interactivePrompt: null };
          }}
        />
      {:else if view === 'diff'}
        {#if diffViewComponent}
          <svelte:component
            this={diffViewComponent}
            files={diffFiles}
            loading={diffLoading}
            syncStatus={diffSyncStatus}
            revertingHunkId={revertingHunkId}
            stagingHunkId={stagingHunkId}
            unstagingHunkId={unstagingHunkId}
            stagingAll={stagingAll}
            unstagingAll={unstagingAll}
            committing={committing}
            pulling={pulling}
            pushing={pushing}
            on:commit={requestCommit}
            on:pull={() => void pullChanges()}
            on:push={() => void pushChanges()}
            on:stageAll={() => void stageAllChanges()}
            on:unstageAll={() => void unstageAllChanges()}
            on:stageHunk={(event: CustomEvent<{ diff: string; hunkId: string }>) => stageHunk(event.detail.diff, event.detail.hunkId)}
            on:unstageHunk={(event: CustomEvent<{ diff: string; hunkId: string }>) => unstageHunk(event.detail.diff, event.detail.hunkId)}
            on:revert={(event: CustomEvent<{ diff: string; hunkId: string }>) => revertHunk(event.detail.diff, event.detail.hunkId)}
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
            fileKind={selectedDocument?.kind ?? 'text'}
            imageDataUrl={selectedDocument?.imageDataUrl ?? ''}
            dirty={editorDirty}
            loading={fileLoading}
            saving={savingFile}
            creating={creatingFile}
            on:browse={(event: CustomEvent<{ path: string }>) => loadFiles(event.detail.path)}
            on:openFile={(event: CustomEvent<{ path: string }>) => openFile(event.detail.path)}
            on:save={(event: CustomEvent<{ content: string }>) => saveFile(event.detail.content)}
            on:createFile={(event: CustomEvent<{ path: string; content: string }>) => createFile(event.detail.path, event.detail.content)}
            on:createDirectory={(event: CustomEvent<{ path: string }>) => createDirectory(event.detail.path)}
            on:duplicateFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) => duplicateFile(event.detail.fromPath, event.detail.toPath)}
            on:renameFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) => renameFile(event.detail.fromPath, event.detail.toPath)}
            on:moveFile={(event: CustomEvent<{ fromPath: string; toPath: string }>) => moveFile(event.detail.fromPath, event.detail.toPath)}
            on:deleteFile={(event: CustomEvent<{ path: string }>) => deleteFile(event.detail.path)}
            on:uploadFile={(event: CustomEvent<{ path: string; contentBase64: string }>) => uploadFile(event.detail.path, event.detail.contentBase64)}
            on:downloadFile={(event: CustomEvent<{ path: string }>) => downloadFile(event.detail.path)}
            on:change={(event: CustomEvent<{ content: string }>) => {
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

    <BottomNav currentView={view === 'costs' || view === 'logs' ? 'chat' : view} disabled={!currentRepo} on:navigate={(event) => navigateMainView(event.detail.view)} />
    <AppMenu
      open={menuOpen}
      currentRepo={currentRepo}
      theme={theme}
      followUpCostGuardEnabled={followUpCostGuardEnabled}
      followUpCostGuardEnabledHasOverride={followUpCostGuardEnabledHasOverride}
      followUpCostSoftLimitUsd={followUpCostSoftLimitUsd}
      followUpCostSoftLimitUsdDefault={defaultFollowUpCostSoftLimitUsd}
      followUpCostSoftLimitHasOverride={followUpCostSoftLimitHasOverride}
      on:close={() => (menuOpen = false)}
      on:chooseRepo={() => {
        menuOpen = false;
        workspaceOpen = true;
      }}
      on:openCosts={() => void openCostView()}
      on:openLogs={() => void openLogView()}
      on:openPiLogin={() => {
        menuOpen = false;
        void openPiLogin();
      }}
      on:setTheme={(event) => setTheme(event.detail.value)}
      on:setFollowUpCostGuardEnabled={(event) => setFollowUpCostGuardEnabled(event.detail.value)}
      on:resetFollowUpCostGuardEnabled={resetFollowUpCostGuardEnabled}
      on:setFollowUpCostSoftLimitUsd={(event) => setFollowUpCostSoftLimitUsd(event.detail.value)}
      on:resetFollowUpCostSoftLimitUsd={resetFollowUpCostSoftLimitUsd}
      on:logout={logout}
    />
    <PiLoginModal
      open={piLoginOpen}
      loading={piAuthLoading}
      submitting={piAuthSubmitting}
      providers={piAuthProviders}
      errorMessage={piAuthError}
      on:close={() => {
        piLoginOpen = false;
        piAuthError = '';
      }}
      on:refresh={() => void loadPiAuthStatus()}
      on:submit={(event) => loginPiToken(event.detail.provider, event.detail.token)}
      on:logout={(event) => logoutPiProvider(event.detail.provider)}
    />
    <WorkspacePicker
      open={workspaceOpen}
      loading={workspaceLoading}
      cloning={workspaceCloning}
      currentPath={workspacePath}
      currentRepo={currentRepo}
      entries={workspaceEntries}
      on:close={() => (workspaceOpen = false)}
      on:browse={(event) => loadWorkspaces(event.detail.path)}
      on:select={(event) => selectRepo(event.detail.path)}
      on:clone={(event) => cloneRepo(event.detail.remoteUrl, event.detail.destinationPath)}
    />
    <CommandPalette
      open={commandPaletteOpen}
      loading={commandStateLoading}
      busy={commandBusy}
      state={commandState}
      theme={theme}
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