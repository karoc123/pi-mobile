import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

const isTestProvider = () => process.env.PI_TEST_PROVIDER === '1';

export function getTestModel(modelRuntime: ModelRuntime) {
  return isTestProvider() ? modelRuntime.getModel('faux', 'faux-1') : undefined;
}

export async function setupTestProvider(modelRuntime: ModelRuntime): Promise<void> {
  if (!isTestProvider()) {
    return;
  }

  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.setRuntimeApiKey('faux', 'test-key');

  const stepFn = (context: {
    messages: readonly { role: string; content: unknown; toolName?: string }[];
  }) => {
    const last = context.messages[context.messages.length - 1];
    if (last.role === 'user') {
      const text =
        typeof last.content === 'string'
          ? last.content
          : Array.isArray(last.content)
            ? last.content
                .map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : ''))
                .join('')
            : '';
      if (text.includes('trigger:tool_read')) {
        return fauxAssistantMessage([fauxToolCall('read', { path: 'notes.txt' })]);
      }
      if (text.includes('trigger:ask_user')) {
        return fauxAssistantMessage([
          fauxToolCall('ask_user', {
            title: 'Question',
            questions: [
              { id: 'q1', label: 'Proceed?', options: ['Yes', 'No'], allowFreeText: true },
            ],
          }),
        ]);
      }
      const singleWordMatch = /single word\s+([A-Z0-9_-]+)/i.exec(text);
      if (singleWordMatch) {
        return fauxAssistantMessage(singleWordMatch[1].toUpperCase());
      }
      return fauxAssistantMessage(`Echo: ${text}`);
    }
    if (last.role === 'toolResult') {
      return fauxAssistantMessage(`Finished tool execution for ${last.toolName ?? 'tool'}.`);
    }
    return fauxAssistantMessage('READY');
  };

  faux.appendResponses(Array.from({ length: 50 }, () => stepFn));
}
