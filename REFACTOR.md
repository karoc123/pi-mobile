# REFACTOR PLAN: Container-Only Runtime (Workspace/DB/PI Volumes)

## 1. Zielbild

PiMobile laeuft als host-unabhaengiger Container-Stack mit genau drei persistenten Volumes:

- `workspace` fuer Repositories und Arbeitsdateien
- `db` fuer costs/logs/known_hosts
- `pi` fuer Pi-Agent Auth/Model/Session Daten

Zusatzbedingungen aus Entscheidungen:

- SSH-Trust: automatisch bestaetigen (sinnvoll: `StrictHostKeyChecking=accept-new`)
- SSH private key: nicht im `pi`-Volume, nur per Compose-Secret einschleusen
- Pi-Login: nur Token-Login im UI (kein separater Test-Button)
- known_hosts: im `db`-Volume
- Release/Publishing: aktuell out of scope

## 2. Scope und Non-Goals

### In Scope

- Docker Runtime von Host-Bind-Mounts auf Volumes + Secrets umstellen
- SSH Runtime-Policy fuer clone/pull/push vereinheitlichen
- UI/Backend Flow fuer Token-basierten Pi-Login ergaenzen
- Dokumentation auf neues Betriebsmodell umstellen
- Testabdeckung fuer neue Pfade (SSH/Clone/Pi-Login/Persistenz) erweitern

### Out of Scope

- Registry Publishing, CI Release Pipeline, Tagging-Strategie
- Voller OAuth Browser-Flow fuer Pi
- Multi-user / role-based auth

## 3. Aktuelle Ist-Lage (kurz)

- Compose nutzt aktuell Host-Mounts fuer `/workspace`, `~/.pi`, `~/.ssh`, `.gitconfig`.
- Git-Operationen laufen ueber `WorkspaceService` + `GitService`.
- Workspace-Clone ist bereits im UI vorhanden (`WorkspacePicker`).
- Pi SDK Integration ist vorhanden (`@earendil-works/pi-coding-agent`), aber kein UI Token-Login.

## 4. Ziel-Architektur (technisch)

### 4.1 Persistenz und Pfade

- `WORKSPACE_ROOT=/workspace`
- `COSTS_DB_PATH=/data/db/costs.sqlite`
- `LOGS_DIR=/data/db/logs`
- `PI_AGENT_DIR=/data/pi/agent`
- `PI_SESSION_DIR=/data/pi/sessions`
- `known_hosts=/data/db/known_hosts`

### 4.2 SSH Policy

Global fuer alle Git-Aufrufe:

- `GIT_SSH_COMMAND="ssh -i /home/node/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/data/db/known_hosts"`

Warum `accept-new`:

- sichere Default-Variante fuer Auto-Trust
- verhindert interaktive Prompts
- speichert beim Erstkontakt persistente Hostkeys
- bleibt MITM-resistenter als `StrictHostKeyChecking=no`

### 4.3 Secrets Modell

- SSH key kommt als Compose secret (file mount unter `/run/secrets/...`).
- EntryPoint kopiert secret -> `/home/node/.ssh/id_ed25519`, setzt `chmod 600`.
- Secret wird nie in Image eingebrannt, nicht in `pi`-Volume persistiert.

### 4.4 Pi Login (Token only)

- UI-Menue bietet "Pi Login".
- User waehlt Provider und gibt Token ein.
- Backend validiert Token bei Login-Aktion.
- Token wird via SDK AuthStorage persistiert (`/data/pi/agent/auth.json`).

## 5. Refactor Phasen

## Phase 0: Baseline und Safety Net

Ziel: reproduzierbare Ausgangsbasis vor Behaviour-Aenderungen.

Arbeiten:

- Bestehende Tests gruener Zustand (`npm test`).
- Optionaler Smoke-Lauf lokal dokumentieren.
- Neue "Container-only" Annahmen als ADR/Abschnitt vorbereiten.

Abnahme:

- Baseline-Testlauf dokumentiert.
- Keine offenen roten Tests vor Start von Phase 1.

## Phase 1: Container Runtime auf Volumes + Secrets umstellen

Ziel: Host-Mount-Freiheit im Laufbetrieb.

Dateien:

- `Dockerfile`
- `docker-compose.yml`
- neue Datei: `docker/entrypoint.sh` (oder `scripts/container-entrypoint.sh`)
- `.env.example`

Arbeiten:

1. EntryPoint einfuehren

- SSH-Verzeichnis erstellen
- Secret-File einlesen und Key schreiben
- Rechte setzen
- known_hosts Datei im `db`-Volume initialisieren
- danach App starten

2. Compose refactor

- Host-Binds entfernen (`WORKSPACE_HOST_PATH`, `PI_HOME_HOST_PATH`, `SSH_HOST_PATH`, `GITCONFIG_HOST_PATH`)
- Named volumes `workspace`, `db`, `pi` definieren
- Secret fuers SSH key file definieren
- Env auf neue Pfade umstellen

3. Config defaults anpassen

- Defaults auf container-interne Pfade setzen (wie oben)

Abnahme:

- `docker compose up --build` startet ohne Host-Mounts.
- Container erzeugt/reused Volumes korrekt.
- Backend Health zeigt Ressourcen auf neuen Pfaden als erreichbar.

## Phase 2: Git/SSH Verhalten vereinheitlichen

Ziel: clone, pull, push laufen ohne interaktive SSH Prompts.

Dateien:

- `src/backend/services/workspace-service.ts`
- `src/backend/services/git-service.ts`
- ggf. `src/backend/utils/process.ts` (nur falls env-helper benoetigt)
- `src/backend/config.ts`

Arbeiten:

1. SSH Env Builder

- zentrale Funktion fuer Git-env (inkl. `GIT_SSH_COMMAND`)
- gleiche Env fuer clone/pull/push verwenden

2. known_hosts im db-Volume

- sicherstellen, dass `UserKnownHostsFile=/data/db/known_hosts` genutzt wird

3. Fehlerpfade verbessern

- klare Errors bei fehlendem SSH key
- klare Errors bei Auth-Fehlern remote

Abnahme:

- Erstes SSH clone auf unbekannten Host funktioniert ohne Prompt.
- known_hosts Datei wird automatisch befuellt.
- pull/push nutzen dieselbe Policy.

## Phase 3: Pi Token Login API im Backend

Ziel: API-Endpunkte fuer Token-Login, Logout und Status.

Dateien:

- `src/shared/contracts.ts`
- `src/backend/app.ts`
- neue Datei: `src/backend/services/pi-auth-service.ts`
- ggf. `src/backend/services/pi-agent-session-adapter.ts` (nur falls Rehydrate notwendig)

Arbeiten:

1. Contracts erweitern

- Request/Response Typen fuer:
  - `GET /api/pi/auth/status`
  - `POST /api/pi/auth/login-token`
  - `POST /api/pi/auth/logout`

2. PiAuthService

- nutzt SDK `AuthStorage` und optional `ModelRegistry`
- schreibt Token provider-spezifisch in auth storage
- validiert Token bei Login (Minimal-Validierung: Provider erreichbar + auth check)

3. API Routing

- auth-geschuetzt wie andere API routes
- strukturierte Fehlercodes fuer UI handling

Abnahme:

- Token login speichert credentials persistent im `pi`-Volume.
- Logout entfernt provider credentials.
- Status-API zeigt provider auth state.

## Phase 4: UI Integration (Menu -> Pi Login)

Ziel: Token-Login direkt aus der bestehenden UI-Steuerung.

Dateien:

- `src/frontend/components/AppMenu.svelte`
- `src/frontend/App.svelte`
- neue Datei: `src/frontend/components/PiLoginModal.svelte`
- ggf. `src/frontend/lib/api.ts` (nur Typnutzung, keine Logikaenderung noetig)

Arbeiten:

1. Menue-Aktion

- neuer Menuepunkt "Pi Login"
- oeffnet Modal/Dialog

2. Modal

- Provider-Auswahl
- Token-Feld
- Submit/Cancel

3. Behaviour

- beim Submit Backend login-token route aufrufen
- Erfolg/Fehler via Banner
- kein separater Test-Button
- Login darf serverseitig validieren und Fehler direkt zeigen

Abnahme:

- Login komplett aus UI moeglich.
- Fehlerfaelle sichtbar und fuer User verstaendlich.
- Keine Regression fuer bestehendes Menue.

## Phase 5: Tests (TDD-orientiert)

Ziel: Refactor durch Tests absichern, inklusive Kompatibilitaet bestehender Flows.

### Backend Unit/Integration

- `src/backend/services/workspace-service.test.ts`
  - clone mit SSH env policy
- `src/backend/services/git-service.test.ts`
  - pull/push nutzen SSH policy
- neue tests `src/backend/services/pi-auth-service.test.ts`
  - token login success
  - token login invalid
  - logout
  - status
- `src/backend/app.test.ts`
  - neue endpoints auth-guarded
  - response/error contracts

### Frontend Tests

- neue/erweiterte component tests:
  - menue zeigt Pi Login action
  - modal submit ruft API
  - API error -> banner

### E2E / Playwright

- `playwright/tests/mobile-flow.spec.ts` erweitern:
  - login -> workspace picker -> clone flow weiterhin intakt
  - pi login modal vorhanden und submitbar

### Kompatibilitaets-Checks (explizit)

- Bestehende routes unveraendert nutzbar:
  - `/api/workspaces/clone`
  - `/api/git/pull`
  - `/api/git/push`
  - `/api/agent/*`
- Bestehende mobile navigation und diff/editor/chat bleiben unveraendert.

Abnahme:

- `npm test` gruen
- relevante e2e smoke tests gruen

## Phase 6: Doku Refactor

Ziel: keine Diskrepanz zwischen Architektur, README und Runtime.

Dateien:

- `README.md`
- `.env.example`
- `docs/ARCHITECTURE.md`
- optional ADR unter `docs/adr/` (falls eingefuehrt)

Arbeiten:

1. README

- Docker quickstart auf Volumes + secrets aktualisieren
- host-unabhaengigen Betrieb explizit beschreiben
- Pi Login im UI dokumentieren

2. ARCHITECTURE

- Host-Mount Diagramm auf Volume/Secret Modell aktualisieren
- SSH `accept-new` policy und known_hosts im db volume dokumentieren

3. Troubleshooting

- fehlender/ungueltiger SSH secret
- invalid token login
- volume reset / backup hinweise

Abnahme:

- Doku entspricht realem compose setup.
- Kein Verweis mehr auf veraltete Host-Binds fuer SSH/pi.

## Phase 7: End-to-End Abnahme und Hardening

Ziel: stabiler Betrieb ueber Rebuild/Restart.

Checks:

1. Fresh start

- Volumes neu, container startet, login ok

2. Runtime persistenz

- clone repo
- pi token login speichern
- container neu bauen/starten
- repo + costs/logs + pi auth weiterhin vorhanden

3. Git runtime

- clone/pull/push ohne Host-Interaktion

4. Health und logs

- `/api/health` zeigt alle required resources ok
- logs weiterhin persistiert im `db` volume

Abnahme:

- alle oben genannten checks bestanden und dokumentiert.

## 6. API Aenderungen (geplant)

Neue Endpoints:

- `GET /api/pi/auth/status`
- `POST /api/pi/auth/login-token`
- `POST /api/pi/auth/logout`

Contract-Hinweis:

- bestehendes Fehlerformat (`ApiErrorResponse`) weiterverwenden
- requestId/retriable Felder beibehalten

## 7. Sicherheits- und Betriebs-Hinweise

- `accept-new` ist Trade-off zwischen Bedienbarkeit und Sicherheit; bewusste Entscheidung.
- Secret-Dateien niemals in Logs ausgeben.
- SSH key material nur in runtime path halten, nicht persistieren.
- known_hosts bewusst persistent im `db`-Volume.

## 8. Offene Huerden: Status nach Entscheidungen

1. SSH Trust UX

- Status: geloest durch `accept-new`, kein UI prompt noetig.

2. SSH key Trennung von Pi-Daten

- Status: geloest durch Compose secret + runtime copy.

3. Pi Login im UI

- Status: offen, aber klar implementierbar (Token-only).

4. Host-Unabhaengigkeit

- Status: geloest im Zielbetrieb nach Phase 1.

## 9. Umsetzungsreihenfolge (empfohlen)

1. Phase 1 (Container/Compose/EntryPoint)
2. Phase 2 (Git SSH policy)
3. Phase 3 (Pi auth backend)
4. Phase 4 (UI integration)
5. Phase 5 (tests)
6. Phase 6 (docs)
7. Phase 7 (final hardening)

## 10. Definition of Done

Der Refactor gilt als abgeschlossen, wenn:

- Laufbetrieb ohne Host-Mounts fuer workspace/pi/ssh/gitconfig moeglich ist
- genau drei persistente Volumes genutzt werden (`workspace`, `db`, `pi`)
- SSH clone/pull/push ohne interaktive prompts funktionieren
- Pi token login aus dem UI funktioniert und persistent bleibt
- alle relevanten Tests gruen sind
- README + ARCHITECTURE konsistent mit der Implementierung sind
