# PiMobile verschlanken

Stand: 2026-10-10. Ergebnis aus Repo-Sichtung, Planprüfung und Produktgespräch.
P1–P5 sind auf dem Branch `cleanup/slim` umgesetzt; Ergebnis siehe Abschnitt „Ergebnis“.

## Ziel

PiMobile soll mit weniger eigenem Code, weniger Abhängigkeiten und weniger konkurrierenden
Bedienwegen auskommen, um dauerhaften Wartungsaufwand, Fehlerfläche und den Aufwand einer
späteren Frontend-Migration zu senken.

Das Produktgespräch hat ergeben, dass fast alle Features bleiben. Der Plan verfolgt daher
zwei Hebel:

1. **Entfernen**, was nicht gebraucht wird (Kostenhistorie, Altlasten, überflüssige Abhängigkeiten).
2. **Verdichten**: gleiche Features mit weniger Code. Maßstab ist weniger Code bei identischem
   Verhalten. Reines Verschieben von Code in neue Dateien oder Abstraktionen ohne Netto-Reduktion
   erfüllt das Ziel nicht.

Ausgangslage (versionierte Dateien ohne Lockfile): ca. 19 400 Zeilen. Die größten Dateien sind
`styles.css` (2729), `App.svelte` (2675), `pi-agent-service.ts` (1092), `ChatView.svelte` (987)
und `app.ts` (856).

## Entscheidungen

| ID | Thema | Entscheidung |
| --- | --- | --- |
| Q1 | Produktkern | Repo auswählen → mit dem Agenten arbeiten → Änderungen prüfen → committen/pushen. |
| Q2 | Umfang | Ganzes Projekt verschlanken: Features, Abhängigkeiten, Code. |
| Q3 | Kostenhistorie | Entfernen, einschließlich SQLite-Datenbank. |
| Q4 | Wear-OS-Client | Genutzte Verträge schützen (siehe unten). |
| Q5 | Kostenumfang | Historie und Follow-up cost guard entfernen. **Live-Kosten, Token und Kontext der laufenden Session bleiben** (direkt aus dem SDK). |
| Q6 | Altdaten | Projekt ist nicht deployed: keine Migration, keine Bereinigungsdoku, keine Rücksicht auf bestehende Pfade/Volumes. |
| Q7 | Modellsortierung | Behalten, vereinfacht: Nutzungszähler als kleine JSON-Datei im Backend (`.pi-mobile/model-usage.json`, `{ "provider/model": count }`), erhöht pro Prompt (auch Wear-Prompts). Sortierung: aktuelles Modell → Häufigkeit → Verfügbarkeit → Name. Repo-Gewichtung und Zeitstempel entfallen. |
| Q8 | Editor/Dateimanager | Vollständig behalten (Browsen, Lesen/Schreiben, Erstellen, Umbenennen/Verschieben/Duplizieren/Löschen, Upload/Download). |
| Q9 | Mobile Diagnose | Vollständig behalten (LogView, SSE, Statusleiste, Logrotation). |
| Q10 | Sessionverwaltung | Vollständig behalten (Resume, Tree, Fork, Name, Export). |
| Q11 | Agent-Bedienung | Vollständig behalten (Bash, Queue-Modi, Retry, Compaction). |
| Q12 | Branch-Verwaltung | Behalten. |
| Q13 | Hunk-Review | Behalten (Stage/Unstage/Revert pro Hunk, Stage all). |
| Q14 | Theme | Beide Themes und Umschalter behalten. |
| Q15 | Ausrichtung | Plan um „gleiche Features, weniger Code“ erweitert. |

## Wear-OS-Vertragsgrenze

Geprüft in `../pi-mobile-wear-app` (`ApiClient.kt`, `Models.kt`, `MainScreen.kt`). Der Client
nutzt ausschließlich:

- `POST /api/auth/login`, `GET /api/auth/session`
- `GET /api/agent/state?minimal=true` (`AgentMinimalState`, zeigt `usage.totalCost` an)
- `POST /api/agent/prompt`, `/api/agent/abort`, `/api/agent/new-session`
- `GET /api/workspaces/browse`, `POST /api/workspaces/select`
- `POST /api/git/commit`

Diese Routen und Antwortformen bleiben kompatibel; `usage.totalCost` bleibt (Live-Wert aus
dem SDK). Alle anderen Routen sind nur vom Web-Frontend abhängig. `ARCHITECTURE.md` soll
diese Liste statt der heutigen Pauschalangabe enthalten.

## Arbeitspakete

Reihenfolge nach Risiko und Abhängigkeit. Jedes Paket ist ein eigener, zusammenhängender
Commit mit grünen Tests und Build.

### P1 – Technische Altlasten

- `dev_pid.txt` löschen und in `.gitignore` aufnehmen.
- Playwright `webServer.command` auf `npm start` reduzieren (`prestart` baut bereits).
- Dockerfile mehrstufig: Build-Stage mit Dev-Abhängigkeiten; Runtime-Stage nur mit
  `dist/`, Produktions-`node_modules` (`npm ci --omit=dev`), `docker/entrypoint.sh` und
  benötigten Laufzeitdateien. Den SDK-Laufzeitbedarf (z. B. Assets im Paket) prüfen.
  Mit `npm run verify:container` absichern.
- Compose: ungenutzte Named-Volume-Deklarationen entfernen; Bind Mounts bleiben das Betriebsmodell.
- Direkte Einträge `@codemirror/commands` und `@codemirror/language` aus `package.json`
  entfernen (transitiv über `codemirror`/`basicSetup` vorhanden; kein Bundlegewinn, nur
  weniger gepflegte Direktabhängigkeiten).
- `zod` ersetzen: nur `config.ts` nutzt es. Entweder `typebox` (bereits für `ask-user-tool.ts`
  nötig) oder einfache eigene Parser; das Ergebnis mit der geringeren Codemenge wählen.
  `config.test.ts` sichert das Verhalten.

### P2 – Kostenhistorie abbauen

Entfernen:

- `CostView.svelte`, Menüeintrag, View-State `costs`, zugehöriges CSS.
- `/api/costs`, `CostService` und Tests, Injektion in `app.ts`/`index.ts`/Agent-Service.
- Kostenpersistenz im Agent-Lebenszyklus (Snapshots, Finalisierung, Persistenzfehler).
- Follow-up cost guard: State, „Keep running“, Menüoptionen, ENV-Defaults, localStorage-Keys.
- `COSTS_DB_PATH`/`costsDbPath`, `costs_db`-Health-Prüfung, Compose-/Playwright-Einträge, Fixtures.
- `Cost*`-Typen in `contracts.ts`.

Behalten:

- Live-Kosten, Token und Kontextauslastung der aktuellen Session (`getSessionStats()`,
  `getContextUsage()`), inklusive `AgentUsage.totalCost` und `AgentMinimalState.usage.totalCost`.
- Subscription-/OAuth-Erkennung, WebSocket-Reconnect, Runtime-Polling (nur den Kostenanteil entfernen).

Ersetzen:

- `getModelUsageSummary()` durch einen schlanken `ModelUsageStore` (JSON-Datei unter
  `.pi-mobile`, atomar schreiben via temp + rename, fehlende oder defekte Datei = leere Zählung).
  `rankModelsByUsage` auf die vierstufige Sortierung aus Q7 reduzieren. Contract-Feld
  `lastUsedAt` entfällt; die Palette zeigt nur noch „Used N×“.

`CostService` nutzt `node:sqlite` (Builtin); es entfällt keine npm-Abhängigkeit.

### P3 – Backend verdichten

- **Zentrale Fehlerübersetzung:** `EEXIST` → 409, `ENOENT` → 404 usw. einmal in der
  Error-Middleware (bzw. im `FileService` als `HttpError`-taugliche Domänenfehler) statt
  `try/catch` in jeder Datei-Route.
- **Wiederholte Validierung:** gemeinsamer Helfer für „Pfad erforderlich, nicht `.`“.
- Gleiches Muster für Git-Routen prüfen (Hunk-Stage/-Unstage/-Revert, Branch-Routen).
- Noop-Logger und Runtime-Phasenableitung (SDK-/Mockadapter) zusammenführen, falls netto kürzer.
- Mockadapter an die verbleibenden Befehle angleichen (Kostenanteil entfernen).

### P4 – Frontend verdichten

- **Dateiaktionen in `App.svelte`:** die nahezu identischen Handler (create, createDirectory,
  duplicate, move, rename, delete) über einen gemeinsamen Ablauf (busy → `apiFetch` →
  `loadFiles` → optional `openFile` → Banner) abbilden.
- **Doppelte Validierung:** Pfadprüfungen im Frontend entfernen, die das Backend ohnehin
  mit klarer Fehlermeldung ablehnt; nur UX-relevante Prüfungen (leeres Feld) behalten.
- Weitere Wiederholungsmuster in `App.svelte`, `ChatView.svelte`, `CommandPalette.svelte`
  sichten; Feature-State, der zu einer Komponente gehört, nur dann verschieben, wenn es
  netto Code spart.
- **`styles.css`:** ungenutzte Selektoren ermitteln (Abgleich gegen Klassen in `.svelte`-Dateien)
  und entfernen; doppelte Regeln zusammenfassen. Theme-Variablen bleiben.

### P5 – Dokumentation

- `VISION.md`: Kostenhistorie als Produktversprechen und Workflow-Schritt entfernen.
- `ARCHITECTURE.md`: SDK statt CLI-Prozess im Diagramm, keine unbelegte Tailwind-Angabe,
  echte Navigation, Diagnosewege, Persistenz (`model-usage.json` statt Kosten-DB),
  konkrete Wear-OS-Routenliste.
- `README.md`/Compose-Beispiele: Bind Mounts als Betriebsmodell beschreiben.
- `AGENTS.md`: Kosten-DB-Fakt streichen, Startpfad auf `dist/backend/index.js` korrigieren.
- `.env.example`, `CONTEXT.md`: Kosten-Einstellungen und -Bezüge bereinigen.

## Abnahme

- Repo-Auswahl, Agentprompt/Abbruch, Wiederverbindung, Review (inkl. Hunks), Commit/Push,
  Editor, Sessionfunktionen, Logs funktionieren mobil wie bisher.
- Passwortgrenzen, Pfadbegrenzung, Git-Sicherheit und Prozessbereinigung bleiben wirksam.
- Die oben gelisteten Wear-OS-Routen und `AgentMinimalState` bleiben unverändert kompatibel.
- Start ohne Kosten-DB und Kostenkonfiguration; kein verbliebener Kostenverbraucher.
- Modellsortierung funktioniert mit fehlender, leerer und defekter `model-usage.json`.
- `npm test`, `npm run build`, `npm run test:e2e`; bei P1-Containeränderungen zusätzlich
  `npm run verify:container`. Es gibt keinen Lint-Befehl; keinen behaupten.
- Lockfile bereinigt.
- Ergebnis messen und im Hand-off nennen: Zeilen (gesamt und je Großdatei) und direkte
  Abhängigkeiten vorher/nachher.

## Restrisiken

- P3/P4 verändern viel bestehenden Code ohne Featurewechsel; Regressionen sind nur so gut
  abgefangen wie die Tests. Vor dem Verdichten eines Bereichs prüfen, ob Tests das Verhalten
  abdecken, und fehlende gezielt ergänzen.
- Die Einsparung durch P3/P4 ist eine Schätzung; harte Zahlen erst nach Umsetzung.
- Das Wear-OS-Repo wurde nur gelesen, nicht gebaut oder gegen den Server getestet.

## Ergebnis

Gemessen gegen `e43da6a` (versionierte Dateien ohne Lockfile und ohne diesen Plan):

| Kennzahl | Vorher | Nachher |
| --- | --- | --- |
| Zeilen gesamt | 19 423 | ca. 17 100 |
| `styles.css` | 2729 | 2421 |
| `App.svelte` | 2675 | 1975 |
| `pi-agent-service.ts` | 1092 | 793 |
| `app.ts` | 856 | 715 |
| Direkte Abhängigkeiten (Runtime + Dev) | 19 + 15 | 6 + 25 |
| Runtime-Image | 1,09 GB | 719 MB |

Entfernt wurden `zod`, `@codemirror/commands` und `@codemirror/language` als direkte Einträge
sowie die SQLite-Kostenpersistenz. Frontend-Pakete sind Dev-Abhängigkeiten, weil sie gebündelt werden.

Nebenbefunde:

- `POST /api/files/delete` mit `notes/..` umging die alte `.`-Prüfung und hätte das Repo-Verzeichnis
  rekursiv gelöscht. Die Pfadprüfung normalisiert jetzt und ist durch einen Test abgedeckt.
- Auf frischen Volumes fehlte `/data/pi/agent`; der Container-Health-Check war dadurch schon vor
  der Aufräumaktion `degraded`. Der Entrypoint legt das Verzeichnis jetzt an.

Bewusst nicht umgesetzt:

- Doppelt definierte CSS-Selektoren (7) wurden nicht zusammengeführt: Zwischen den Definitionen
  liegen Regeln gleicher Spezifität, ein Verschieben würde die Kaskade ändern; ohne visuelle Tests
  zu riskant für ca. 30 Zeilen.
- Vorbestehende `svelte-check`-Fehler (9, kein Projekt-Skript) und Typfehler in zwei Testdateien
  wurden nicht behoben; zwei Blob-Typfehler sind durch den Download-Umbau entfallen.
