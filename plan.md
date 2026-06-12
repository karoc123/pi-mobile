# Plan: Interactive Prompts im Chat UI (Option B)

## Ziel

Die AI soll im Chat strukturierte Rückfragen mit mehreren Optionen (plus optionalem Freitext) stellen können. Der User beantwortet diese per Tap, und die Antworten werden als normale Nachricht in den Chat gesendet.

---

## 1. Architektur-Übersicht

```
AI (pi SDK) ruft Tool "ask_user" auf
        │
        ▼
PiAgentService.handleSessionEvent()
  erkennt tool_execution_start mit toolName === "ask_user"
        │
        ▼
PiAgentBroadcaster.interactivePrompt(prompt)
        │
        ▼
WebSocket → App.svelte → ChatView.svelte
        │
        ▼
InteractiveCard.svelte (inline im Chat-Log)
        │
        ▼
User tippt Antworten → Submit
        │
        ▼
POST /api/agent/prompt  (formatierter Antwort-Text)
        │
        ▼
Normale User-Nachricht erscheint im Chat
```

---

## 2. Contracts (`src/shared/contracts.ts`)

### Neue Typen

```ts
/** Eine einzelne Frage mit Auswahlmöglichkeiten */
export type InteractiveQuestion = {
  id: string;
  label: string;
  options: string[];
  allowFreeText: boolean;
  placeholder?: string; // nur relevant wenn allowFreeText === true
};

/** Vollständiger interaktiver Prompt */
export type InteractivePrompt = {
  promptId: string;
  title: string;
  questions: InteractiveQuestion[];
};

/** Antwort auf einen interaktiven Prompt */
export type InteractiveResponse = {
  promptId: string;
  answers: InteractiveAnswer[];
};

/** Antwort auf eine einzelne Frage */
export type InteractiveAnswer = {
  questionId: string;
  value: string; // gewählte Option oder Freitext
};
```

### Neuer WebSocket-Event-Typ

```ts
// Erweiterung von WebsocketEnvelope:
| {
    type: "interactive_prompt";
    payload: InteractivePrompt;
  }
```

---

## 3. Backend-Änderungen

### 3.1 `PiAgentBroadcaster` (`src/backend/services/pi-agent-broadcaster.ts`)

Neue Methode:

```ts
interactivePrompt(prompt: InteractivePrompt) {
  this.broadcast({
    type: "interactive_prompt",
    payload: prompt,
  });
}
```

### 3.2 `PiAgentService` (`src/backend/services/pi-agent-service.ts`)

In `handleSessionEvent()`: Bei `tool_execution_start` mit `toolName === "ask_user"` den Prompt parsen und broadcasten:

```ts
if (event.type === "tool_execution_start" && event.toolName === "ask_user") {
  const prompt = parseInteractivePromptArgs(event.args);
  if (prompt) {
    this.broadcaster.interactivePrompt(prompt);
  }
}
```

`parseInteractivePromptArgs()` extrahiert aus den Tool-Arguments:

```json
{
  "title": "Ein paar Fragen zum Setup",
  "questions": [
    {
      "id": "framework",
      "label": "Welches Frontend-Framework?",
      "options": ["React", "Vue", "Svelte"],
      "allowFreeText": true,
      "placeholder": "Anderes Framework..."
    }
  ]
}
```

Validierung:
- `title`: required, non-empty string
- `questions`: required, non-empty array
- Jede Frage: `id` + `label` required, `options` mindestens 1 Element, `allowFreeText` boolean

### 3.3 Kein neuer REST-Endpoint nötig

Die Antwort wird via `POST /api/agent/prompt` als formatierter Text gesendet — kein neuer Endpoint.

---

## 4. Frontend-Änderungen

### 4.1 `App.svelte`

Neuer Handler im `handleSocketMessage()`:

```ts
if (event.type === "interactive_prompt") {
  agentSnapshot = {
    ...agentSnapshot,
    interactivePrompt: event.payload,
  };
  return;
}
```

Neuer State:

```ts
let interactivePrompt: InteractivePrompt | null = null;
```

Weitergabe an `ChatView`:

```svelte
<ChatView
  ...
  interactivePrompt={interactivePrompt}
  on:interactiveSubmit={handleInteractiveSubmit}
/>
```

`handleInteractiveSubmit()`:
1. Baut Antwort-Text aus den Antworten
2. Sendet `POST /api/agent/prompt`
3. Setzt `interactivePrompt = null`

### 4.2 `ChatView.svelte`

Neue Props:

```ts
export let interactivePrompt: InteractivePrompt | null = null;
```

Neues Event:

```ts
dispatch('interactiveSubmit', { response: InteractiveResponse });
```

Rendering: Wenn `interactivePrompt !== null`, wird am Ende des Chat-Logs (vor dem Composer) eine `<InteractiveCard>` gerendert.

### 4.3 Neue Komponente: `InteractiveCard.svelte`

**Pfad:** `src/frontend/components/InteractiveCard.svelte`

#### Props

```ts
export let prompt: InteractivePrompt;
```

#### Events

```ts
dispatch('submit', { response: InteractiveResponse });
dispatch('dismiss');  // User bricht ab
```

#### State

```ts
let answers: Record<string, string> = {};          // questionId → value
let freeTextValues: Record<string, string> = {};   // questionId → raw freetext input
let showFreeText: Record<string, boolean> = {};    // questionId → ist das Freitext-Feld offen?
let submitted = false;
```

#### Layout (Mobile-First)

```
┌─────────────────────────────────┐
│  🤔 Ein paar Fragen zum Setup   │  ← title
├─────────────────────────────────┤
│  Welches Framework?             │  ← label
│  ┌────────┐ ┌──────┐ ┌───────┐ │
│  │ React  │ │ Vue  │ │Svelte │ │  ← Option-Chips
│  └────────┘ └──────┘ └───────┘ │
│  ┌─────────────────────────────┐│
│  │ Anderes...              [✓] ││  ← Freitext (optional)
│  └─────────────────────────────┘│
├─────────────────────────────────┤
│  TypeScript?                    │
│  ┌────┐ ┌──────┐               │
│  │ Ja │ │ Nein │               │
│  └────┘ └──────┘               │
├─────────────────────────────────┤
│         [ Antwort senden ]      │  ← Submit (nur aktiv wenn alle beantwortet)
│         [ abbrechen ]           │  ← Dismiss (ghost button)
└─────────────────────────────────┘
```

#### UX-Regeln

1. **Chip-Buttons:** Jede Option als Pill-Button, `min-height: 44px`, `min-width: 60px`
2. **Tap-Target:** Mindestens 44×44px (iOS HIG)
3. **Auswahl-Visualisierung:** Ausgewählter Chip bekommt `primary`-Hintergrund, andere `secondary`
4. **Freitext:** Erscheint nur, wenn `allowFreeText === true`. Wird als zusätzlicher Chip „Andere..." gerendert. Bei Tap öffnet sich ein `<input>` darunter.
5. **Submit-Button:** Deaktiviert, solange nicht jede Frage eine Antwort hat. Position: sticky am unteren Rand der Karte.
6. **Dismiss:** Kleiner, unaufdringlicher Button (ghost style) neben Submit.
7. **Scroll-Verhalten:** Bei >3 Fragen: `max-height` mit `overflow-y: auto` innerhalb der Karte.
8. **Dark Mode:** Alle Farben via CSS-Variablen aus dem Theme.

#### Antwort-Format (an `POST /api/agent/prompt`)

```
Antworten auf: "Ein paar Fragen zum Setup"

- Welches Framework? → React
- TypeScript? → Ja
```

Der Antwort-Text wird so formatiert, dass die AI den Kontext versteht.

---

## 5. Datenfluss im Detail

### 5.1 AI stellt interaktive Frage

```
1. AI: "Dazu hätte ich noch ein paar Fragen."
   → Normales text_delta, erscheint als Markdown-Nachricht

2. AI ruft Tool "ask_user" auf:
   → tool_execution_start { toolName: "ask_user", args: { title: "...", questions: [...] } }
   
3. Backend: PiAgentService.handleSessionEvent()
   → Erkennt ask_user
   → Validiert args → InteractivePrompt
   → broadcaster.interactivePrompt(prompt)

4. WebSocket: { type: "interactive_prompt", payload: { promptId: "...", title: "...", questions: [...] } }

5. App.svelte: setzt interactivePrompt State
   → ChatView bekommt Prop-Update
   
6. ChatView: Rendert <InteractiveCard> inline nach der letzten Nachricht
```

### 5.2 User beantwortet und submitted

```
1. User tippt Optionen an → InteractiveCard State-Update (rein clientseitig)

2. User tippt "Antwort senden"
   → InteractiveCard emitted 'submit' mit InteractiveResponse
   
3. ChatView dispatched 'interactiveSubmit' an App.svelte

4. App.svelte.handleInteractiveSubmit():
   a. Baut Antwort-Text
   b. POST /api/agent/prompt { prompt: "Antworten auf: ...\n\n- Frage 1 → Antwort\n..." }
   c. Setzt interactivePrompt = null
   
5. Backend: Normale Prompt-Verarbeitung
   → User-Nachricht erscheint im Chat
   → AI antwortet darauf
```

### 5.3 Abbruch

```
1. User tippt "abbrechen"
   → InteractiveCard emitted 'dismiss'
   → interactivePrompt = null
   → Karte verschwindet ohne Antwort
```

---

## 6. Implementierungs-Reihenfolge

| Schritt | Datei(en) | Aufwand |
|---------|-----------|---------|
| 1. Contracts definieren | `src/shared/contracts.ts` | klein |
| 2. Backend: Broadcaster erweitern | `src/backend/services/pi-agent-broadcaster.ts` | klein |
| 3. Backend: ask_user-Tool erkennen + parsen | `src/backend/services/pi-agent-service.ts` | mittel |
| 4. Frontend: InteractiveCard-Komponente | `src/frontend/components/InteractiveCard.svelte` (neu) | groß |
| 5. Frontend: ChatView integrieren | `src/frontend/components/ChatView.svelte` | mittel |
| 6. Frontend: App.svelte Event-Routing | `src/frontend/App.svelte` | mittel |
| 7. CSS / Mobile-First Styling | `InteractiveCard.svelte` + globale Styles | mittel |
| 8. Tests | `*.test.ts` | mittel |
| 9. Doku aktualisieren | `docs/ARCHITECTURE.md` | klein |

---

## 7. Fallbacks & Edge Cases

1. **Ungültiger ask_user-Payload:** Backend logged Warnung, broadcastet _nicht_. AI-Nachricht erscheint normal.
2. **Mehrere gleichzeitige Prompts:** Nur der neueste wird gerendert (überschreibt `interactivePrompt`). Sollte in der Praxis nicht vorkommen.
3. **User verlässt den Chat-Tab:** `interactivePrompt` bleibt im State. Kehrt User zurück, sieht er die Karte wieder.
4. **WebSocket disconnect während Prompt offen:** Karte bleibt sichtbar (clientseitiger State). Submit geht via REST.
5. **AI sendet weiteren Text während Prompt offen:** Nachrichten erscheinen normal _unter_ der InteractiveCard.
6. **Repo-Wechsel während Prompt offen:** `repo_selected`-Event setzt auch `interactivePrompt = null`.
7. **New-Session während Prompt offen:** `interactivePrompt = null` (State wird via leeren `agentSnapshot` zurückgesetzt).
