// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { hydrateMessagesFromSession } from './pi-agent-hydrator.js';

describe('hydrateMessagesFromSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses createdAt when available', () => {
    const createdAt = '2026-06-07T14:33:22.000Z';

    const messages = hydrateMessagesFromSession([
      {
        role: 'user',
        createdAt,
        content: 'hello',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(createdAt);
  });

  it('hydrates timestamp from numeric milliseconds', () => {
    const timestampMs = 1780823602123;

    const messages = hydrateMessagesFromSession([
      {
        role: 'assistant',
        timestamp: timestampMs,
        content: [{ type: 'text', text: 'answer' }],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(new Date(timestampMs).toISOString());
  });

  it('hydrates timestamp from numeric seconds', () => {
    const timestampSeconds = 1780823602;

    const messages = hydrateMessagesFromSession([
      {
        role: 'user',
        timestamp: timestampSeconds,
        content: 'hello',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe(new Date(timestampSeconds * 1000).toISOString());
  });

  it('falls back to now when no valid timestamp is present', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-07T18:05:00.000Z'));

    const messages = hydrateMessagesFromSession([
      {
        role: 'assistant',
        timestamp: 'not-a-date',
        content: [{ type: 'text', text: 'answer' }],
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].timestamp).toBe('2026-06-07T18:05:00.000Z');
  });

  it('hydrates tool calls on assistant message and enriches with tool results', () => {
    const messages = hydrateMessagesFromSession([
      {
        role: 'user',
        content: 'Read note',
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'read',
            arguments: { path: 'notes.txt' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'read',
        isError: false,
        content: [{ type: 'text', text: 'file contents here' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is what was read.' }],
      },
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].text).toBe('Read note');

    expect(messages[1].role).toBe('assistant');
    expect(messages[1].text).toBe('');
    expect(messages[1].tools).toBeDefined();
    expect(messages[1].tools).toHaveLength(1);
    expect(messages[1].tools?.[0]).toEqual({
      id: 'call-1',
      name: 'read',
      status: 'complete',
      detail: 'file contents here',
    });

    expect(messages[2].role).toBe('assistant');
    expect(messages[2].text).toBe('Here is what was read.');
    expect(messages[2].tools).toBeUndefined();
  });

  it('marks tool as error when toolResult has isError: true', () => {
    const messages = hydrateMessagesFromSession([
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-err',
            name: 'bash',
            arguments: { command: 'exit 1' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-err',
        toolName: 'bash',
        isError: true,
        content: 'Command failed with exit code 1',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].tools?.[0].status).toBe('error');
    expect(messages[0].tools?.[0].detail).toBe('Command failed with exit code 1');
  });
  it('matches parallel results strictly by call id and leaves missing results aborted', () => {
    const messages = hydrateMessagesFromSession([
      {
        role: 'assistant',
        content: ['a', 'b', 'c'].map((id) => ({
          type: 'toolCall',
          id,
          name: 'read',
          arguments: { path: id },
        })),
      },
      { role: 'toolResult', toolCallId: 'b', toolName: 'read', content: 'B' },
      { role: 'toolResult', toolCallId: 'a', toolName: 'read', content: 'A' },
      { role: 'toolResult', toolCallId: 'unknown', toolName: 'read', content: 'wrong' },
    ]);
    expect(messages[0].tools).toMatchObject([
      { id: 'a', detail: 'A', status: 'complete' },
      { id: 'b', detail: 'B', status: 'complete' },
      { id: 'c', status: 'aborted' },
    ]);
    expect(
      hydrateMessagesFromSession(
        [{ role: 'assistant', content: [{ type: 'toolCall', id: 'pending', name: 'read' }] }],
        true,
      )[0].tools?.[0].status,
    ).toBe('running');
  });

  it('bounds tool arguments and results in snapshots', () => {
    const input = {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'large',
          name: 'write',
          arguments: { content: 'x'.repeat(100_000) },
        },
      ],
    };
    expect(hydrateMessagesFromSession([input])[0].tools?.[0].detail?.length).toBeLessThan(260);
    const result = hydrateMessagesFromSession([
      input,
      { role: 'toolResult', toolCallId: 'large', content: 'x'.repeat(100_000) },
    ]);
    expect(result[0].tools?.[0].detail?.length).toBeLessThan(4120);
    expect(result[0].tools?.[0].detail).toContain('gekürzt');
  });
});
