# Umbauplan: PiMobile verschlanken (Runde 2)

Stand: 2026-10-11. Ergebnis aus vollständiger Code-Sichtung, kritischer Prüfung der ersten
Refactoring-Ideen (Abschnitt 3) und den Produktentscheidungen vom 2026-10-11 (Abschnitt 2).

## Ziel

Gleiche Features mit deutlich weniger eigenem Code, klaren Zuständigkeiten und erstmals
vollständiger Typ- und Lint-Abdeckung des Frontends. UI und UX dürfen sich ändern, wo das
Code spart und kein Feature verloren geht.

Maßstab wie in Runde 1: Eine Änderung zählt nur, wenn sie die Architektur nachvollziehbar
vereinfacht **und** netto Code entfernt. Reines Verschieben zählt nicht. Einzige Ausnahme:
CSS aus `styles.css` in Komponenten-`<style>` zu verlagern ist erlaubt, weil der
Svelte-Compiler dann ungenutzte Selektoren meldet. Auch dieser Schritt muss netto Zeilen
sparen.

---

## 1. Ausgangslage

Gemessen mit `wc -l` auf versionierten Dateien (ohne Lockfile), Commit `334e8bf`:

| Bereich                            | Zeilen     |
| ---------------------------------- | ---------- |
| Backend (ohne Tests)               | 4.985      |
| Svelte-Komponenten                 | 5.348      |
| `styles.css`                       | 2.421      |
| Frontend-TS (`lib/`, ohne Tests)   | 318        |
| `shared/contracts.ts`              | 563        |
| **Produktivcode gesamt**           | **13.635** |
| Vitest-Tests                       | 2.316      |
| Playwright (E2E)                   | 177        |
| Hilfsskripte inkl. Guardrail-Tests | 651        |

Ausgangsstand grün: 82 Vitest-Tests, 17 Guardrail-Tests, `npm run typecheck`.

### Befunde über die erste Ideenliste hinaus

1. **Frontend ohne Typprüfung.** 13 von 14 Komponenten nutzen Svelte-4-Syntax
   (`export let`, `$:`, `createEventDispatcher`, `on:`), nur `InteractiveCard` nutzt Runes.
   `svelte-check` und `typescript-eslint` unterstützen TypeScript 7 nicht (Peer-Range bis 6.x),
   `tsc` prüft keine `.svelte`-Dateien. Rund 5.300 Zeilen UI sind damit ungeprüft; ESLint
   prüft heute nur die Skripte unter `scripts/`.
2. **Doppelte Tool-Anzeige.** Das Backend serialisiert Tool-Aufrufe als Text
   (`[tool:name] args`, `pi-agent-hydrator.ts`), das Frontend gewinnt sie per Regex zurück
   (`ChatView.parseToolCalls`). Parallel baut `App.svelte` aus `tool_activity`-Events ein
   zweites „Tool trace“-Panel mit Batches.
3. **Der Mock dupliziert die Runtime.** `PiAgentMockAdapter` (347 Zeilen) baut Befehle, Usage
   und Streaming nach; dazu kommen 12 `piMockMode`-Verzweigungen. Gebraucht wird er nur für
   E2E und einen Unit-Test. Dadurch läuft der echte Session-Pfad in E2E nie. Das SDK bringt
   einen Test-Provider mit (`fauxProvider` in `@earendil-works/pi-ai`, einbindbar über
   `ModelRuntime.registerNativeProvider`).
4. **Dreifacher Kosten-Workaround plus Polling.** Das Backend ergänzt fehlende Kosten aus den
   Nachrichten (`resolveSessionTotalCost`). Das Frontend hält alte Kosten fest
   (`coalesceUsageCost`) und pollt bzw. resynct, solange die Kosten 0 sind. Zusätzlich gibt es
   7-s-Polling bei nicht-idle Agent, Resync-Bursts (300 ms bis 12 s) nach jedem Connect und
   `loadAgentState()` nach jedem Befehl. Grund: Bei Nachrichten-Resets (Resume, Tree, Compact,
   New) pusht das Backend keinen Snapshot.
5. **Dateitransport per Base64 in JSON.** Upload, Download, Binär- und Bildanzeige laufen als
   Base64 in JSON. Das JSON-Limit von 2 MB lässt Uploads über ca. 1,5 MB scheitern, Base64 kostet
   33 % Overhead, und die Datei liegt komplett im RAM des Pi. Die Binärerkennung nutzt eine
   Liste mit rund 60 Endungen plus eigene MIME-Tabelle.
6. **Git/SSH-Konfiguration doppelt.** Der Entrypoint setzt bereits `user.name`/`user.email`,
   startet `ssh-agent` und lädt den Key. Trotzdem baut `git-env.ts` zusätzlich
   `GIT_SSH_COMMAND`/`GIT_AUTHOR_*`, kopiert die Werte in `process.env` und reicht das Env
   außerdem durch `GitService` und `WorkspaceService`. `WorkspaceService` repariert zudem
   „dubious ownership“ zur Laufzeit.
7. **Produktionspfade im Code.** `config.ts` hat sechs `resolveDefault…`-Funktionen für
   `/data/...`-Pfade, die Compose ohnehin setzt, und einen eigenen `.env`-Loader, obwohl die
   npm-Skripte `--env-file-if-exists` nutzen.
8. **Toter Code.** `appendLocalSystemMessage` wird nie aufgerufen, `localSystemMessages` ist also
   immer leer. `getSubmittedSlashCommand`, `formatUsageSummary` und `formatModelLabel` werden nur
   in Tests benutzt. `CodeEditor.readOnly` wird nie gesetzt, `DiffFile.diff` nie gelesen.
   `contracts.ts` enthält 9 ungenutzte Request/Response-Typen.
9. **CSS-Wildwuchs.** Es gibt zwei parallele Token-Familien (`--ink/--surface…` und
   `--terminal-*`, dazu Reste von `--cli-*`) mit 47 Variablen pro Theme. `--text`,
   `--text-on-accent` und `--accent-dim` werden benutzt, aber nie definiert.
10. **Kleinere Punkte.** Das Health-Polling läuft alle 10 s, auch bei geschlossenem
    Status-Panel. Die Chips „Session active“ (immer wahr) und „Log stream“ (steht schon in der
    LogView) sind redundant. README und Skills verweisen auf ein nicht existierendes
    `docs/DEVELOPMENT.md`. `package.json` pinnt `pi-coding-agent` 1.1.0, installiert ist
    1.0.3 (`npm ci` steht aus).

---

## 2. Entscheidungen

| ID  | Thema           | Entscheidung                                                                                                                                                                                                                                                 |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Frontend-Basis  | Svelte 5 bleibt, **vollständige Umstellung auf Runes** (`$state`, `$derived`, `$props`, Callback-Props, `{#await}`). Danach keine Legacy-Syntax mehr.                                                                                                        |
| E2  | TypeScript      | Auf **6.0.x** festsetzen, damit `svelte-check`, `typescript-eslint` und `eslint-plugin-svelte` laufen. Zurück zu TS 7, sobald diese Werkzeuge es unterstützen.                                                                                               |
| E3  | Geräte          | Android Chrome, iOS Safari **und** Desktop/Tablet bleiben voll unterstützt; zweispaltige Layouts bleiben.                                                                                                                                                    |
| E4  | Diff-Rendering  | diff2html bleibt, die AGENTS.md-Regel bleibt unverändert.                                                                                                                                                                                                    |
| E5  | Echtzeitkanal   | WebSocket bleibt. Vereinfacht wird die Logik drumherum (E10).                                                                                                                                                                                                |
| E6  | Tool-Anzeige    | **Vereinheitlichen**: Tool-Aufrufe hängen strukturiert an der Assistant-Nachricht und erscheinen in einer aufklappbaren Inline-Anzeige. Tool-Trace-Panel und Regex-Parsing entfallen.                                                                        |
| E7  | Command-Palette | **Straffen** von 15 auf 8 Bereiche (siehe P4e). Theme nur noch im Menü; `/copy` entfällt, der Copy-Button pro Nachricht bleibt.                                                                                                                              |
| E8  | Mock-Modus      | Ersetzen durch den SDK-Test-Provider. Im Produktivcode bleibt höchstens ein Schalter.                                                                                                                                                                        |
| E9  | Dateitransport  | Rohdaten statt Base64 (`GET`/`PUT /api/files/raw`).                                                                                                                                                                                                          |
| E10 | Agent-Zustand   | Das Backend pusht bei jedem Reset einen Snapshot; das Frontend pollt nicht mehr. Der Kosten-Fallback lebt nur noch im Backend.                                                                                                                               |
| E11 | Wear-OS-Vertrag | Unverändert: Routen laut `ARCHITECTURE.md` §2.5, `AgentMinimalState`, `{ commitSha }` bei Commit und die Fehlerhülle `{ ok, error: { code, message, requestId, retriable } }`. Der Wear-Client parst alle vier Fehlerfelder als Pflichtfelder (`Models.kt`). |

---

## 3. Bewertung der ersten Ideenliste

| Paket                                | Urteil                    | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 – Autonome Views                   | **Übernommen, erweitert** | Richtig erkannt: `App.svelte` besitzt den Zustand aller Ansichten. Korrektur: `DiffView` hat 15 Props und 11 Events, nicht 24 Props. Falle: Wird der Editor autonom und beim Tab-Wechsel unmountet, gehen ungespeicherte Änderungen verloren; dafür braucht es eine klare Zustandsregel (Abschnitt 4). Ein `on:repoChanged`-Event wäre Svelte-4-Syntax und müsste später noch einmal umgebaut werden, deshalb direkt Runes. Ziel für `App.svelte` sind rund 150 Zeilen statt 500.   |
| 2 – Strategy Pattern für die Runtime | **Ersetzt**               | Ein `AgentSessionEngine`-Interface mit zwei Implementierungen behält die doppelte Befehlslogik und fügt eine Abstraktion hinzu. Besser: Mock ganz entfernen und den echten Adapter mit dem SDK-Test-Provider fahren (E8). Das spart mehr (rund 400 statt 200 Zeilen) und testet den echten Pfad. Die Entfernung des Broadcasters wird übernommen.                                                                                                                                   |
| 3 – Indirektionen/Git                | **Teilweise**             | `applyHunk` mit Modus: übernommen, zusätzlich eine Route statt drei. `RepositoryRuntimeService` ist kein reiner Pass-Through, sondern Orchestrierung (Watcher, Agent, Broadcast); er wird eine Funktion im Composition Root (`index.ts`). `createGitRouter` **verworfen**: reines Verschieben, verstößt gegen die eigene Regel 3. Stattdessen ein Routen-Helfer, der `currentRepo()`, Body-Lesen und `res.json` bündelt, sodass Routen von fünf auf ein bis zwei Zeilen schrumpfen. |
| 4 – Typisierter API-Client           | **Ersetzt**               | Ein `api.git.stageHunk()`-Objekt spiegelt nur die Routenliste und spart kaum Code. Der eigentliche Hebel sind rund 19 gleichartige `try/catch → handleApiFailure`-Blöcke und rund 16 Busy-Flags. Lösung: zentrale 401- und Fehlerbehandlung in `apiFetch`, ein `run()`-Helfer für Busy und Toast; Typen kommen weiter aus `contracts.ts`.                                                                                                                                           |

---

## 4. Zielarchitektur

### Frontend

```text
src/frontend/
  main.ts
  App.svelte                Auth-Gate: LoginScreen oder <Workspace/>
  Workspace.svelte          Shell: Kopfleiste, Tabs, Menü, Toast, Sheets; besitzt die Live-Verbindung
  lib/
    api.ts                  apiFetch + get/post/put; 401 → onUnauthorized; run(action, okText)
    live.svelte.ts          class LiveConnection: WebSocket, Reconnect, Agent-Snapshot, workspaceChange
    editor-state.svelte.ts  offenes Dokument + Entwurf (überlebt Tab-Wechsel)
    toast.svelte.ts         Banner-Zustand
    clipboard.ts            copyText() mit execCommand-Fallback (HTTP ist kein Secure Context)
    markdown.ts, diff.ts, agent-usage.ts, command-suggestions.ts
  components/
    Sheet.svelte            natives <dialog> als Bottom-Sheet (Escape, Backdrop, Fokus)
    ChoiceGroup.svelte      Umschaltgruppe für Palette-Einstellungen
    ChatView.svelte, ToolCalls.svelte, InteractiveCard.svelte
    DiffView.svelte, EditorView.svelte, CodeEditor.svelte
    CommandPalette.svelte, LogView.svelte, SystemStatus.svelte
    WorkspacePicker.svelte, PiLoginSheet.svelte, AppMenu.svelte, LoginScreen.svelte, BottomNav.svelte
```

Regeln:

- **Zustand gehört der Komponente, die ihn anzeigt.** Jede View lädt und ändert ihre Daten
  selbst über `api.ts`. Props gibt es nur für echte Shell-Daten: Repo, Agent-Snapshot,
  `workspaceChange`, `active`.
- **Zwei Ausnahmen**, weil ein Tab-Wechsel Views unmountet: Agent-Snapshot und
  Verbindungsstatus (`LiveConnection`, lebt so lange wie die eingeloggte Sitzung) sowie das
  offene Editor-Dokument (`editor-state`).
- **Querverbindungen** laufen über `workspaceChange` (Pfad + Zähler). Der Wert ändert sich bei
  `workspace_changed` und nach eigenen Git- und Dateiaktionen. Diff und Editor laden per
  `$effect` neu, wenn sie aktiv sind. `diffRefreshPending` und `scheduleDiffReload` entfallen.
- **Logout oder Sitzungsablauf:** `authenticated = false` unmountet `Workspace`. Der Cleanup
  schließt den Socket und setzt `editor-state` zurück. `resetAuthenticatedState()` entfällt.
- **Repo-Wechsel:** `{#key repo.absolutePath}` um die Views plus `editor-state.reset()`.
  Keine manuelle Rücksetzliste mehr.
- **Lazy Loading** nur noch für CodeMirror (608 kB). Diff- und Editor-View werden normal
  gebündelt (diff2html ≈ 17 kB gzip); die drei `ensure…Loaded`-Konstrukte entfallen.
- **Native Elemente:** `<dialog>` für alle Sheets ersetzt Overlay-Divs, `stopPropagation` und
  die Click-outside-Logik in `DiffView`. `<details>` übernimmt Ein- und Ausklappen
  (Tool-Details, verborgene Nachrichten).
- **Busy-Zustand:** pro View ein `busy: string | null` (z. B. `'commit'`, `'hunk:<id>'`)
  statt einzelner Flags.

### Backend

```text
src/backend/
  index.ts                  Composition Root; activateRepo(repo) = Watcher + Agent + Broadcast
  app.ts                    Middleware, Auth-Gate, Routen über route()/repoRoute()
  config.ts                 Env lesen, Dev-Defaults; Prod-Pfade kommen aus Dockerfile/Compose
  services/
    agent-service.ts        Zustand, SDK-Events → WS-Envelopes, Befehle
    agent-session.ts        Session-Erzeugung, Modellauflösung, Command-State-Mapping
    agent-hydrator.ts       Session-Nachrichten → ChatMessage inkl. tools
    test-provider.ts        SDK-faux-Provider, nur bei PI_TEST_PROVIDER aktiv
    git-service.ts, file-service.ts, workspace-service.ts, watcher-service.ts,
    log-service.ts, auth-service.ts, pi-auth-service.ts, model-usage-store.ts,
    resource-health-service.ts, websocket-hub.ts, ask-user-tool.ts
```

Entfallen: `pi-agent-mock-adapter.ts`, `pi-agent-broadcaster.ts`,
`repository-runtime-service.ts`, `utils/git-env.ts`.

---

## 5. Arbeitspakete

Reihenfolge nach Risiko und Abhängigkeit. Jeder Schritt ist ein eigener Commit mit grünem
`npm run check`, `npm test` und `npm run build`, ab P3 zusätzlich `npm run test:e2e`.
**Vertragsänderungen (Routen, Envelopes) landen immer im selben Commit wie der umgebaute
Verbraucher.** Das Frontend wird von unten nach oben umgestellt: zuerst die Views, zuletzt
Shell und Chat. So schrumpft `App.svelte` mit jedem Schritt, und Runes-Kinder hängen an
einem noch alten Eltern-Component, nie umgekehrt.

### P0 – Vorarbeiten und Sicherheitsnetz

- `npm ci` (Lockfile und installierte Version angleichen), Ausgangswerte messen.
- TypeScript auf 6.0.x pinnen. `svelte-check` in `typecheck` aufnehmen; `typescript-eslint`
  und `eslint-plugin-svelte` für `src/**` aktivieren. Vorhandene Befunde beheben, keine Regel
  abschwächen.
- Schichtgrenzen per ESLint `no-restricted-imports`: frontend darf nicht auf backend,
  `node:*` oder Serverpakete zugreifen; shared nur auf shared. Damit entfallen
  `import-graph.mjs`, `check-architecture.mjs`, die zugehörigen Guardrail-Tests und
  `@babel/parser`; die Zyklusprüfung fällt weg. `check-deps.mjs` (exakte Versionen,
  Runtime-Pakete in `dependencies`) bleibt und liest Imports per einfachem Regex.
  `format.mjs` und `lint-fix.mjs` bleiben (Schutz vor Massenformatierung).
- **Spike Test-Provider:** `fauxProvider()` per `registerNativeProvider` in den
  `ModelRuntime` der Session einhängen, mit Echo-Antwort, geskriptetem `read`-Tool-Call und
  `ask_user`-Call. Ergebnis: `test-provider.ts` (Ziel unter 60 Zeilen), aktiviert über
  `PI_TEST_PROVIDER=1`. Fallback, falls `registerNativeProvider` nicht reicht: eine
  Extension-Datei im Test-`PI_AGENT_DIR`.
- **E2E erweitern**, mit Test-Provider und vor dem UI-Umbau: Tool-Anzeige,
  Interactive Prompt beantworten, Command-Palette (Modell sehen, Session umbenennen,
  neue Session), LogView mit Filter, Branch anlegen und wechseln, Upload/Download,
  Bildvorschau.

Abnahme: Die Gates prüfen TS und Svelte; die neuen E2E-Fälle laufen grün gegen den
**heutigen** Stand.

### P1 – Agent-Backend

- Mock entfernen: `pi-agent-mock-adapter.ts`, `MockRuntimeContext`, alle
  `piMockMode`-Zweige. `PI_MOCK_MODE` wird zu `PI_TEST_PROVIDER` (Playwright, `.env.example`).
  Der Container-Smoke braucht keinen Agent-Schalter: Er promptet nicht, und der Entrypoint
  legt die Pi-Verzeichnisse an.
- `PiAgentBroadcaster` entfernen; der Service ruft `broadcast({ type, payload })` direkt auf.
  Die Typsicherheit kommt aus `WebsocketEnvelope`.
- Service und Adapter nach Verantwortung schneiden (Abschnitt 4) statt nach Mock oder echt.
  `noopLogger` entfällt, der Logger wird Pflicht.
- **Snapshot-Push:** neues Envelope `snapshot` ersetzt `connected`. Es wird beim Connect
  **und** nach jedem Nachrichten-Reset gesendet: Repo-Wechsel, New, Resume, Fork, Tree,
  Compact, Bash. Das alte Frontend übernimmt es im selben Commit wie heute `connected`.
- `resolveSessionTotalCost` bleibt die einzige Stelle für den Kosten-Fallback; bei
  `agent_end` geht ein finaler Status raus.
- Optional (Ressourcen): Text-Streaming als Delta statt Volltext pro Token.

Entfällt: rund 400–600 Zeilen (Mock 347, Broadcaster 59 plus 98 Zeilen Test, Zweige,
Mock-Kontext). Abnahme: Der E2E-Chat läuft über den echten Session-Pfad;
`GET /api/agent/state?minimal=true` bleibt unverändert.

### P2 – Backend-Routen, Dienste, Konfiguration

- Routen-Helfer `route(fn)` / `repoRoute(fn)`: `currentRepo()`, Body-Felder,
  `res.json(result ?? { ok: true })`. Gilt für Git-, Datei-, Workspace- und Agent-Routen.
  Antwortformen der Wear-Routen bleiben gleich.
- `RepositoryRuntimeService` wird zu `activateRepo()` in `index.ts`.
- Git- und SSH-Konfiguration wandern in den Entrypoint: `core.sshCommand` mit
  `UserKnownHostsFile=/data/db/known_hosts` und `StrictHostKeyChecking=accept-new` (der Key
  kommt über `ssh-agent`), dazu `safe.directory '*'`. Es entfallen `git-env.ts`, die
  Env-Durchreichung in `GitService`, `WorkspaceService` und `runCommand`, die
  Laufzeit-Reparatur für „dubious ownership“ und die Felder `SSH_*` und `GIT_USER_*` in
  `config.ts`. Lokal ohne Docker gilt die eigene Git-Konfiguration. Der Container-Smoke prüft
  zusätzlich `git config --global core.sshCommand`.
- `config.ts`: Prod-Pfade als `ENV` im Dockerfile statt `resolveDefault…`-Funktionen; der
  eigene `.env`-Loader entfällt.
- `ResourceHealthService`: eine Prüffunktion statt zwei, der Mock-Sonderfall entfällt.
- `LogService`: eine `log(level, …)`-Methode, `child()` baut darauf auf.
  `WatcherService`: ungenutzte Option `ignoredRelativeRoots` entfernen.
- `contracts.ts`: tote Typen entfernen (`File*Request`, `PiAuth*Response`,
  `GitHunkMutationRequest` u. a.), außerdem `DiffFile.diff` samt Merge-Logik und
  `AgentSnapshot.isConfigured`.
- Optionaler Spike: `PiAuthService` über die SDK-API (`ModelRuntime.login`/`logout`, eine
  gemeinsame Runtime mit der Session) statt `auth.json` von Hand. Dann entfällt auch
  `refresh()` in `getCommandState`.

Abnahme: alle Backend-Tests grün; `npm run verify:container` grün.

### P3 – Frontend-Fundament

- `lib/api.ts`: 401 löst ein globales Sitzungsende aus; `run(action, okText)` kapselt Busy
  und Toast. Fehlertexte enthalten die Request-ID wie heute.
- `toast.svelte.ts`, `clipboard.ts`, `Sheet.svelte`, `ChoiceGroup.svelte`.
- **Theme-Tokens zusammenführen**: eine semantische Familie mit rund 18 statt 47 Variablen
  pro Theme. `--terminal-*` und `--cli-*` werden aufgelöst, die undefinierten Variablen
  behoben. Das kommt vor P4, damit beim Verlagern des CSS in die Views keine Variable
  zweimal umbenannt wird.
- Das bestehende `App.svelte` nutzt ab hier `api.ts` und `run()`.

### P4 – Views (je ein Commit, Runes, autonom, scoped CSS)

- **4a LogView + SystemStatus:** Abfrage, Filter, Paging und SSE leben in der View. Den
  Lebenszyklus der EventSource steuert ein `$effect`; die eingebaute Wiederverbindung ersetzt
  den eigenen Retry-Timer (der Server sendet `retry:`). Health-Polling läuft nur, solange das
  Status-Panel offen ist; die Chips „Session“ und „Log stream“ entfallen.
- **4b WorkspacePicker, PiLoginSheet, AppMenu, LoginScreen:** laden und handeln selbst; die
  Shell steuert nur `open`.
- **4c DiffView:** Stage, Unstage und Revert über **eine** Route
  `POST /api/git/hunk { diff, action }` (`GitService.applyHunk`). Branch-Sheets über `Sheet`,
  ein `busy`-Schlüssel statt sieben Flags, die Click-outside-Logik entfällt. Nach einem Revert
  ändert sich `workspaceChange`; der Editor lädt die offene Datei neu, wenn sie nicht dirty ist.
- **4d EditorView + Dateitransport:** `GET /api/files/raw?path=…[&download=1]` (Bildvorschau
  per `<img src>`, Download per `<a download>`) und `PUT /api/files/raw?path=…` (Stream in
  eine Temp-Datei, dann `rename`, also atomar; Limit z. B. 50 MB). `readFile` liefert nur noch
  `text | image | binary`, für Nicht-Text ohne Inhalt. Binärerkennung über NUL-Bytes in den
  ersten 8 KB statt Endungsliste, MIME-Typ über Express. Das Aktions-Sheet wird datengetrieben
  (eine Tabelle für Titel, Label und Felder statt verschachtelter Ternaries). Es entfallen
  `FileDownloadInfo`, die Base64-Felder, `saveBase64File`, der FileReader-Code sowie die Routen
  `/download` und `/upload`.
- **4e CommandPalette mit 8 Bereichen:** Model · Session (Kennzahlen, Name, Export, Neu) ·
  Resume · Tree · Fork · Bash · Settings (Thinking, Auto-Compact und „Compact now“, Steering-
  und Follow-up-Modus, Auto-Retry samt Abbrechen) · Commands. Die Palette lädt den
  Command-State selbst; `ChoiceGroup` übernimmt die Umschalter. Theme und `/copy` entfallen
  hier.

Abnahme je View: die E2E-Fälle des Bereichs grün; `svelte-check` ohne Warnungen; keine
Legacy-Syntax (`createEventDispatcher`, `export let`, `$:`, `on:`) mehr in der Datei; der
zugehörige Teil von `App.svelte` ist gelöscht.

### P5 – Shell und Live-Verbindung

- `App.svelte` wird zum Auth-Gate, `Workspace.svelte` zur Shell (Runes).
- `LiveConnection`: Reconnect mit Backoff, zusätzlich bei `visibilitychange` und `online`;
  serverseitiger WS-Ping (`ws`) erkennt halboffene Verbindungen. Snapshots und Events sind die
  einzige Quelle für den Agent-Zustand.
- Es entfallen `resetAuthenticatedState`, `ensure…Loaded`, `localSystemMessages` und
  `chatMessages`.
- **Eigener Commit:** Resync-Bursts, Agent-State-Polling, `coalesceUsageCost` und
  `loadAgentState()` nach Befehlen entfernen. So lässt sich der Schritt gezielt zurücknehmen,
  falls echte Geräte Probleme zeigen.

### P6 – Chat und strukturierte Tools

- Vertrag: `ChatMessage.tools?: { id, name, status, detail }[]`. Der Hydrator liest
  Tool-Calls und -Results aus den Session-Nachrichten; Live-Events aktualisieren die Tools der
  zugehörigen Assistant-Nachricht über `chat_message_updated`.
- Eine `ToolCalls`-Komponente (Icons plus `<details>`). Es entfallen das Tool-Trace-Panel, die
  Batches, `parseToolCalls`, die `[tool:…]`-Serialisierung, das `tool_activity`-Envelope,
  `AgentSnapshot.tools` und die Hide/Expand-Maps.
- Tastatur und Scrollen vereinfachen: Die Bottom-Nav wird auf Touch-Geräten per CSS `:has()`
  ausgeblendet, solange der Composer fokussiert ist. „Am Ende kleben“ läuft über die
  Scroll-Position statt über Element-Vermessung. `visualViewport` dient nur noch dazu, bei
  geöffneter iOS-Tastatur ans Ende zu scrollen.
- Kopieren über `clipboard.ts`; `InteractiveCard` bleibt (bereits Runes), wird aber
  aufgeräumt.

### P7 – CSS-Abschluss

- `styles.css` enthält nur noch Tokens, Basis, Primitive (Buttons, Felder, Karten, Notice),
  das Shell-Layout und die diff2html-Overrides; alles andere liegt scoped in den
  Komponenten.
- Breakpoints für Desktop und Tablet bleiben, werden aber wo möglich auf zwei reduziert.
- Abnahme: beide Themes geprüft auf Android, iOS und Desktop; E2E-Screenshots für Chat, Diff
  und Editor in beiden Themes.

### P8 – Dokumentation

- `AGENTS.md`: nur noch Runes, TS-6-Pin mit Begründung, Zustandsregeln aus Abschnitt 4,
  `PI_TEST_PROVIDER`. Den Verweis auf `docs/DEVELOPMENT.md` entfernen (auch in README und
  Skills).
- `ARCHITECTURE.md`: Snapshot-Push statt Polling, Rohdaten-Dateitransport, strukturierte
  Tools, Git/SSH im Entrypoint, Wear-Vertrag inklusive Fehlerhülle.
- `CONTEXT.md`: „Mock session“ wird „Test provider“, „Agent broadcaster“ entfällt.
- `docs/CLEANUP_PLAN.md` und dieser Plan bekommen nach Abschluss ein Ergebnis oder werden
  gelöscht.

---

## 6. Zielwerte (Schätzung)

| Bereich                                | Heute      | Ziel            |
| -------------------------------------- | ---------- | --------------- |
| Backend (ohne Tests)                   | 4.985      | 3.300–3.700     |
| Svelte + CSS + Frontend-TS             | 8.087      | 4.500–5.200     |
| `contracts.ts`                         | 563        | ca. 400         |
| **Produktivcode gesamt**               | **13.635** | **8.200–9.300** |
| Hilfsskripte inkl. Guardrail-Tests     | 651        | ca. 250         |
| Direkte Abhängigkeiten (Runtime + Dev) | 6 + 31     | 7 + 33          |

Die Abhängigkeiten steigen leicht: `svelte-check`, `typescript-eslint` und
`eslint-plugin-svelte` kommen für die volle Typ- und Lint-Abdeckung dazu, `@earendil-works/pi-ai`
wird für den Test-Provider direkt deklariert (ist schon transitiv installiert),
`@babel/parser` fällt weg. Harte Zahlen erst nach der Umsetzung; jedes Paket nennt seine
Messung im Commit-Text.

---

## 7. Abnahme gesamt

- Alle Workflows funktionieren mobil wie bisher: Repo wählen und klonen, Prompt, Abbruch und
  Queue, Interactive Prompt, Tool-Anzeige, Session-Funktionen (Resume, Tree, Fork, Name,
  Export, Bash, Retry, Compaction), Review mit Hunks, Branches, Commit/Pull/Push, Editor mit
  allen Dateiaktionen, Logs, Status-Panel, beide Themes, Pi-Login.
- Wear-OS-Routen und Antwortformen sind unverändert (E11).
- Passwortschutz auf allen Routen inklusive `/api/files/raw` und WebSocket; Pfadbegrenzung;
  atomare Schreibvorgänge.
- `npm run check` (inklusive `svelte-check` und ESLint über `src/**`), `npm test`,
  `npm run build`, `npm run test:e2e`, `npm run verify:container`.
- Im Frontend kein `createEventDispatcher`, `export let`, `$:` oder `on:` mehr; im Backend
  kein `piMockMode`.

---

## 8. Risiken und offene Spikes

- **Test-Provider (P0):** Passt `fauxProvider` nicht sauber in `ModelRuntime`, bleibt als
  Fallback eine Extension im Test-Agent-Verzeichnis. Scheitert beides, bleibt der Mock
  vorerst, und P1 schrumpft auf Broadcaster-Entfernung und Neuschnitt.
- **Polling-Entfall (P5):** Halboffene Mobilverbindungen und den iOS-Hintergrundmodus kann
  nur ein echtes Gerät prüfen. Deshalb eigener Commit; Heartbeat und `visibilitychange`
  müssen das abfangen.
- **Tastatur und Scrollen (P6):** iOS Safari verhält sich anders als Chrome. Prüfung auf
  echten Geräten nötig, Playwright reicht nicht.
- **TS 6 statt 7:** Der Typecheck wird langsamer; der Downgrade ist bewusst temporär.
- **Großer Frontend-Umbau:** Regressionen fängt nur ab, was die E2E-Tests abdecken; deshalb
  kommt P0 zuerst.
- **Beobachten, nicht Teil dieses Plans:** `GitService.getUntrackedDiff` startet pro
  untracked Datei einen eigenen `git diff`-Prozess. Bei vielen Dateien (z. B. fehlendem
  `.gitignore`) ist das auf dem Pi teuer.

---

## 9. Umsetzungs-Ergebnis

Alle Arbeitspakete P0–P8 wurden erfolgreich und atomar umgesetzt:

- **P0 – Vorarbeiten & Sicherheitsnetz** (`21324d8`): TypeScript ~6.0.2 Pin, svelte-check, typescript-eslint & eslint-plugin-svelte, Test-Provider Spike, 8 Playwright E2E-Tests.
- **P1 – Agent-Backend & Snapshot-Push** (`511ea13`): `piMockMode` und `PiAgentBroadcaster` entfernt, `snapshot` Envelope eingeführt.
- **P2 – Routen, Konfiguration, Git-Laufzeit** (`cf03994`): Route-Helfer `route`/`repoRoute`, SSH/Git in Entrypoint, tote Typen bereinigt.
- **P3 – Frontend-Fundament & Tokens** (`908fe68`): API-Client mit `run()`, Theme-Tokens konsolidiert (18 semantische Variablen), Primitiven `Sheet`/`ChoiceGroup`.
- **P4a – LogView & SystemStatus** (`f034e11`): Svelte 5 Runes, integrierte SSE und Health-Abfrage, scoped CSS.
- **P4b – WorkspacePicker, PiLoginSheet, AppMenu, LoginScreen** (`da7b04c`): Autonome Komponenten mit `<dialog>` Sheets und Runes.
- **P4c – DiffView & Hunk-Route** (`a8f19e1`): Konsolidierte Route `POST /api/git/hunk` (`stage`, `unstage`, `revert`), Einzelflag `busy`.
- **P4d – EditorView & Dateitransport** (`6bc28e8`): `GET /api/files/raw` und `PUT /api/files/raw` (Streaming + Rename), CodeMirror Lazy Loading.
- **P4e – CommandPalette** (`abf41b0`): 8 konsolidierte Funktionsbereiche, Runes und ChoiceGroup.
- **P5 – Shell, Live-Verbindung & Polling-Entfall** (`265656b`): `App.svelte` als Auth-Gate, `Workspace.svelte` als Shell, vollständige Beseitigung von Agent-State-Polling.
- **P6 – Chat & Strukturierte Tools** (`16ec8c1`): `ChatToolCall` in `ChatMessage.tools`, `<ToolCalls>` mit nativem `<details>`, vereinfachtes Auto-Scrollen.
- **P7 – CSS-Abschluss** (`34d6561`): `styles.css` auf 270 Zeilen verdichtet (Tokens + Primitiven), alle Komponenten voll scoped ohne ungenutzte Selektoren.
- **P8 – Dokumentation** (dieser Schritt): `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `README.md`, Skill-Dateien aktualisiert.
