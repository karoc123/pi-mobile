import { defineTool, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * ask_user tool definition.
 *
 * This tool lets the AI ask structured multiple-choice questions to the user.
 * The actual UI rendering happens client-side via the WebSocket interactive_prompt event.
 * The tool handler itself is a no-op that returns a confirmation, because the user's
 * answers are delivered back via a normal prompt (POST /api/agent/prompt).
 */
export const askUserTool = defineTool({
  name: "ask_user",
  label: "Ask user",
  description: "Ask the user a structured multiple-choice question (or multiple questions at once). Use this when you need the user to pick from predefined options.",
  promptSnippet: "ask_user: Ask structured multiple-choice questions to the user",
  promptGuidelines: [
    "Use `ask_user` to present the user with a structured question that has predefined answers.",
    "Provide a clear title for the question group and at least one option per question.",
    "If applicable, set allowFreeText: true so the user can type a custom answer.",
  ],
  parameters: Type.Object({
    title: Type.String({
      description: "Title for the question group shown to the user",
      minLength: 1,
    }),
    questions: Type.Array(
      Type.Object({
        id: Type.String({
          description: "Unique identifier for this question (e.g., 'framework')",
          minLength: 1,
        }),
        label: Type.String({
          description: "The question text displayed to the user (e.g., 'Welches Framework?')",
          minLength: 1,
        }),
        options: Type.Array(Type.String({ minLength: 1 }), {
          description: "Answer options the user can choose from",
          minItems: 1,
        }),
        allowFreeText: Type.Boolean({
          description: "Whether the user can type a custom answer instead of picking an option",
          default: false,
        }),
        placeholder: Type.Optional(
          Type.String({
            description: "Placeholder text for the free-text input field",
          }),
        ),
      }),
      {
        description: "One or more questions to ask",
        minItems: 1,
      },
    ),
  }),
  execute: async (toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<undefined>> => {
    // The actual UI interaction happens client-side.
    // The tool execution is intercepted by PiAgentService.handleSessionEvent()
    // and broadcast via WebSocket as an interactive_prompt event.
    // The handler here just returns a confirmation.
    return {
      content: [{ type: "text", text: `Interactive prompt "${params.title}" sent. Waiting for response...` }],
      details: undefined,
    };
  },
});
