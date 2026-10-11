# UI & UX Improvement Plan: PiMobile Frontend

Dieses Dokument fasst die Ergebnisse des **Impeccable Audits** für die Oberfläche von `pi-mobile` (`src/frontend`) zusammen und definiert konkrete, priorisierte Maßnahmen zur Behebung.

---

## 1. Audit Health Score Übersicht

| #          | Dimension                    |    Score    | Kernbefund                                                                                                |
| ---------- | ---------------------------- | :---------: | --------------------------------------------------------------------------------------------------------- |
| 1          | **Accessibility (A11y)**     |  **1 / 4**  | Fehlende Tastaturfokus-Ringe (`:focus-visible`), kein `prefers-reduced-motion`, lückenhafte ARIA-Zustände |
| 2          | **Performance**              |  **2 / 4**  | Unbegrenztes DOM-Wachstum im Chatverlauf ohne Virtualisierung; wiederholtes Diff-Parsing                  |
| 3          | **Theming**                  |  **2 / 4**  | Solide Token-Architektur, aber hartcodierte Hex-Farben führen zu Kontrastversagen im Light-Theme          |
| 4          | **Responsive Design**        |  **3 / 4**  | Gutes Mobile-First-Konzept, jedoch unterschreiten mehrere Sub-Buttons das 44×44px Touch-Mindestmaß        |
| 5          | **Implementation Integrity** |  **3 / 4**  | 4 Detektor-Treffer (`side-tab`), ansonsten maßgeschneidertes, schlankes Interface                         |
| **Gesamt** |                              | **11 / 20** | **Acceptable (Signifikanter Verbesserungsbedarf)**                                                        |

---

## 2. Detaillierte Befunde & konkrete Maßnahmen

### [P0/P1] Theming & Kontrast: Feste Hex-Farben brechen im Light-Mode

- **Problem:** In [`src/frontend/styles.css#L839-L862`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L839-L862) und [`L953-L1008`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L953-L1008) sind Syntax-, Tool- und Statusfarben als statische Hex-Werte (`#ffbf5e`, `#6dde8c`, `#56b7ff`, `#2e88ff`, `#7ac57a`, `#fd6755`) hinterlegt. Im `vscode-light`-Theme sinkt der Kontrast zu weißem Hintergrund auf ca. 1.5:1 bis 1.9:1.
- **Standard:** WCAG 1.4.3 Contrast (Minimum 4.5:1 für Text) / WCAG 1.4.11 Non-text Contrast (3:1 für Icons).
- **Maßnahme:**
  1. Neue CSS-Variablen in `:root` definieren (z. B. `--tool-read`, `--tool-write`, `--tool-search`, `--tool-terminal`, `--tool-generic`).
  2. In `:root[data-theme="vscode-light"]` angepasste, abgedunkelte Farbwerte bereitstellen.
  3. Die Klassen `.icon-read`, `.icon-write` etc. auf die Variablen umstellen.
- **Impeccable-Kommando:** `/impeccable colorize`

---

### [P1] Accessibility: Fehlende Tastaturfokus-Indikatoren (`:focus-visible`)

- **Problem:** Es existieren im gesamten Projekt keine Stile für `:focus-visible`. Buttons und Nav-Items haben Standard-Outlines, während die Chat-Textarea in [`src/frontend/styles.css#L688-L690`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L688-L690) den Fokusring komplett entfernt (`outline: none;`).
- **Standard:** WCAG 2.4.7 Focus Visible (Level AA).
- **Maßnahme:**
  1. Globalen `:focus-visible`-Stil in [`src/frontend/styles.css`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css) einfügen:
     ```css
     :focus-visible {
       outline: 2px solid var(--accent);
       outline-offset: 2px;
     }
     ```
  2. Spezifische Formularelemente (Inputs, Textarea, Action-Buttons) mit sichtbaren Fokus-Akzenten versehen.
- **Impeccable-Kommando:** `/impeccable harden`

---

### [P1] Accessibility: Modals blockieren Escape-Taste und Tastaturnavigation

- **Problem:**
  - In [`src/frontend/components/CommandPalette.svelte#L66`](file:///home/zink/dev/pi-mobile/src/frontend/components/CommandPalette.svelte#L66) und [`src/frontend/components/AppMenu.svelte#L24`](file:///home/zink/dev/pi-mobile/src/frontend/components/AppMenu.svelte#L24) fängt `on:keydown|stopPropagation` Tastendrücke ab, behandelt aber `Escape` nicht.
  - Tastatur- und Hilfsmittel-Nutzer können offene Overlays nicht mit der `Escape`-Taste schließen.
- **Standard:** WCAG 2.1.2 No Keyboard Trap (Level A).
- **Maßnahme:**
  1. Globalen oder modal-lokalen Keydown-Handler ergänzen:
     ```svelte
     function handleKeydown(event: KeyboardEvent) {
       if (event.key === 'Escape') {
         event.stopPropagation();
         dispatch('close');
       }
     }
     ```
  2. Dialoge mit `window`-Keydown-Listener verknüpfen (`<svelte:window on:keydown={handleKeydown} />`).
- **Impeccable-Kommando:** `/impeccable harden`

---

### [P1] Touch-UX: Touch-Targets unterschreiten 44×44px

- **Problem:**
  - Tool-Toggles im Chat ([`src/frontend/styles.css#L800-L809`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L800-L809)) haben nur `padding: 0.35rem 0.5rem` und eine Gesamthöhe von ~26px.
  - Hunk-Toolbar-Buttons ([`src/frontend/styles.css#L1855-L1860`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L1855-L1860)) sind auf kleinen Smartphones schwer mit dem Daumen zu treffen.
- **Standard:** WCAG 2.5.8 Target Size (Minimum) / Apple HIG & Google Material (mindestens 44×44px bzw. 48×48px für mobile Touch-Ziele).
- **Maßnahme:**
  1. Für interaktive Toggles und Buttons auf mobilen Viewports eine Mindesthöhe von `min-height: 44px` oder ein transparentes Tap-Padding (`padding: 0.6rem 0.8rem`) vergeben.
  2. Abstände zwischen benachbarten klickbaren Elementen leicht vergrößern (`gap: 0.5rem`).
- **Impeccable-Kommando:** `/impeccable layout`

---

### [P2] Accessibility: Fehlende ARIA-Zustände in Navigation & Modalkomponenten

- **Problem:**
  - [`src/frontend/components/BottomNav.svelte#L20-L27`](file:///home/zink/dev/pi-mobile/src/frontend/components/BottomNav.svelte#L20-L27): Der aktive Tab hat keine semantische Kennzeichnung wie `aria-current="page"` oder `aria-selected="true"`.
  - [`src/frontend/components/AppMenu.svelte#L40-L47`](file:///home/zink/dev/pi-mobile/src/frontend/components/AppMenu.svelte#L40-L47): Die Theme-Buttons nutzen kein `aria-pressed`.
  - [`src/frontend/components/InteractiveCard.svelte#L105-L144`](file:///home/zink/dev/pi-mobile/src/frontend/components/InteractiveCard.svelte#L105-L144): Auswahl-Chips besitzen kein `aria-pressed`, und das Freitext-Feld hat kein zugehöriges `<label>` oder `aria-label`.
- **Standard:** WCAG 4.1.2 Name, Role, Value / WCAG 1.3.1 Info and Relationships.
- **Maßnahme:**
  1. `aria-current={item.value === currentView ? 'page' : undefined}` in `BottomNav.svelte` setzen.
  2. `aria-pressed={theme === 'vscode-dark'}` in `AppMenu.svelte` ergänzen.
  3. `aria-pressed` für Chip-Buttons und `aria-label` für Freitexteingaben in `InteractiveCard.svelte` nachrüsten.
- **Impeccable-Kommando:** `/impeccable harden`

---

### [P2] Accessibility: Reine Farbcodierung in der System-Statusleiste

- **Problem:** In [`src/frontend/components/SystemStatusBar.svelte#L97-L103`](file:///home/zink/dev/pi-mobile/src/frontend/components/SystemStatusBar.svelte#L97-L103) und [`src/frontend/styles.css#L1430-L1440`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L1430-L1440) unterscheiden sich `.status-chip.ok`, `.warn` und `.error` ausschließlich durch eine dezente Rahmenfarbe (`border-color`).
- **Standard:** WCAG 1.4.1 Use of Color (Farbe darf nicht das einzige Mittel zur Informationsübertragung sein).
- **Maßnahme:**
  1. Visuelle Statusindikatoren (z. B. Icons wie `✓`, `▲`, `✕` oder Dot-Marker) hinzufügen.
  2. Textuelle Kennzeichnung oder Screenreader-Präfixe (`[OK]`, `[WARN]`, `[ERROR]`) einbinden.
- **Impeccable-Kommando:** `/impeccable clarify`

---

### [P2] Accessibility: Fehlende Unterstützung für `prefers-reduced-motion`

- **Problem:** In [`src/frontend/styles.css`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css) laufen `@keyframes pulse`, `@keyframes terminal-blink` sowie diverse Hover-/Aktiv-Transitions ohne Abfrage der Nutzer-Systemeinstellung.
- **Standard:** WCAG 2.2.2 Pause, Stop, Hide / WCAG 2.3.3 Animation from Interactions.
- **Maßnahme:**
  Media Query am Ende der Stylesheet-Definition einfügen:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- **Impeccable-Kommando:** `/impeccable harden`

---

### [P2] Performance: Unbegrenzter DOM im Chat & ungecachtes Diff-Parsing

- **Problem:**
  - [`src/frontend/components/ChatView.svelte#L813`](file:///home/zink/dev/pi-mobile/src/frontend/components/ChatView.svelte#L813): Alle Nachrichten und Tool-Calls werden flach ohne Virtualisierung gerendert. Bei langen Agent-Sessions führt dies zu spürbarer Trägheit auf Mobilgeräten.
  - [`src/frontend/components/DiffView.svelte#L348`](file:///home/zink/dev/pi-mobile/src/frontend/components/DiffView.svelte#L348): `{@html renderDiff(hunk.diff)}` parst den Diff-String bei jedem Komponenten-Update erneut.
- **Maßnahme:**
  1. Hunk-HTML in `DiffView` memoizen (z. B. über eine `Map<string, string>` gecachte Hilfsfunktion).
  2. Lange Tool-Outputs in `ChatView` standardmäßig eingeklappt halten (bereits teilweise vorhanden) und ggf. ältere Nachrichtenblöcke faul nachladen.
- **Impeccable-Kommando:** `/impeccable optimize`

---

### [P3] Implementation Integrity: `side-tab` Anti-Pattern beheben

- **Problem:** Der Impeccable Detektor moniert 4 dicke linke Rahmenlinien (`border-left: 4px solid ...`) an `.log-level-*` in [`src/frontend/styles.css#L1535-L1549`](file:///home/zink/dev/pi-mobile/src/frontend/styles.css#L1535-L1549).
- **Maßnahme:**
  Die 4px dicken Rahmen durch subtilere Badges, Icon-Tönungen oder zartere 1px-Border-Akzente ersetzen:
  ```css
  .log-level-debug {
    border-left: 1px solid var(--muted);
  }
  .log-level-info {
    border-left: 1px solid var(--accent);
  }
  .log-level-warn {
    border-left: 1px solid var(--warning);
  }
  .log-level-error {
    border-left: 1px solid var(--danger);
  }
  ```
- **Impeccable-Kommando:** `/impeccable polish`

---

## 3. Empfohlene Umsetzungs-Roadmap

1. **Phase 1: Barrierefreiheit & Tastatur (P1)**
   - Globales `:focus-visible` aktivieren.
   - `Escape`-Taste in `CommandPalette`, `AppMenu` und `WorkspacePicker` unterstützen.
   - `prefers-reduced-motion` einbinden.
   - `aria-current` und `aria-pressed` in `BottomNav` und Modals ergänzen.

2. **Phase 2: Theming & Kontrast (P0/P1)**
   - Tool-Icons und Status-Farben auf CSS-Variablen umstellen.
   - Kontrastwerte im `vscode-light`-Theme auditieren und abdunkeln.

3. **Phase 3: Touch & Mobile Ergonomie (P1)**
   - Mindesthöhe von 44px für interaktive Toggles und Hunk-Buttons im Chat & Diff garantieren.
   - `LoginScreen.svelte` mit regulärem `<form>`-Tag ausstatten, um native "Submit"-Tasten auf virtuellen Tastaturen zu unterstützen.

4. **Phase 4: Detektor-Cleanup & Feinschliff (P3)**
   - `.log-level-*` von `side-tab` befreien.
   - Diff-Parsing-Ergebnisse memoisieren.
   - Erneuter Lauf von `impeccable audit`, um den Zielscore (≥ 17/20) zu bestätigen.
