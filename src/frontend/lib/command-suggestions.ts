export type SlashCommandSuggestion = {
  command: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommandSuggestion[] = [
  { command: "/model", description: "Switch models" },
  { command: "/session", description: "Show session info and stats" },
  { command: "/settings", description: "Adjust theme and thinking" },
  { command: "/queue", description: "Control steer/follow-up queue" },
  { command: "/retry", description: "Manage automatic retries" },
  { command: "/compact", description: "Compact the current context" },
  { command: "/bash", description: "Run direct bash commands" },
  { command: "/name", description: "Rename the active session" },
  { command: "/export", description: "Export current session" },
  { command: "/resume", description: "Open a previous session" },
  { command: "/new", description: "Start a fresh session" },
  { command: "/copy", description: "Copy the last assistant reply" },
  { command: "/tree", description: "Jump within the session tree" },
  { command: "/fork", description: "Continue from an earlier prompt" },
  { command: "/commands", description: "List runtime slash commands" },
];

export type SlashCommandQuery = {
  value: string;
  start: number;
  end: number;
};

export type SubmittedSlashCommand = {
  suggestion: SlashCommandSuggestion;
  args: string;
};

export function findSlashCommandQuery(prompt: string, cursorIndex: number): SlashCommandQuery | null {
  const safeCursorIndex = Math.max(0, Math.min(cursorIndex, prompt.length));
  const beforeCursor = prompt.slice(0, safeCursorIndex);
  const afterCursor = prompt.slice(safeCursorIndex);
  const match = /(^|\s)(\/[a-z-]*)$/i.exec(beforeCursor);

  if (!match) {
    return null;
  }

  const value = match[2];
  const start = beforeCursor.length - value.length;
  const afterMatch = /^[a-z-]*/i.exec(afterCursor)?.[0] ?? "";

  return {
    value,
    start,
    end: safeCursorIndex + afterMatch.length,
  };
}

export function getSlashCommandSuggestions(prompt: string, cursorIndex: number) {
  const query = findSlashCommandQuery(prompt, cursorIndex);

  if (!query) {
    return [];
  }

  const normalizedQuery = query.value.toLowerCase();

  return SLASH_COMMANDS.filter((entry) => entry.command.startsWith(normalizedQuery)).slice(0, 6);
}

export function applySlashCommandSuggestion(prompt: string, cursorIndex: number, suggestion: SlashCommandSuggestion) {
  const query = findSlashCommandQuery(prompt, cursorIndex);

  if (!query) {
    return {
      prompt,
      cursorIndex,
    };
  }

  const replacement = `${suggestion.command} `;
  const updatedPrompt = `${prompt.slice(0, query.start)}${replacement}${prompt.slice(query.end)}`;

  return {
    prompt: updatedPrompt,
    cursorIndex: query.start + replacement.length,
  };
}

export function getSubmittedSlashCommand(prompt: string): SubmittedSlashCommand | null {
  const trimmedPrompt = prompt.trim();
  const match = /^(\/[a-z-]+)(?:\s+(.*))?$/i.exec(trimmedPrompt);

  if (!match) {
    return null;
  }

  const normalizedCommand = match[1].toLowerCase();
  const suggestion = SLASH_COMMANDS.find((entry) => entry.command === normalizedCommand);

  if (!suggestion) {
    return null;
  }

  return {
    suggestion,
    args: (match[2] ?? "").trim(),
  };
}
