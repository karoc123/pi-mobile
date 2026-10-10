// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { askUserTool } from './ask-user-tool.js';

describe('askUserTool', () => {
  it('defines tool metadata correctly', () => {
    expect(askUserTool.name).toBe('ask_user');
    expect(askUserTool.label).toBe('Ask user');
    expect(typeof askUserTool.description).toBe('string');
    expect(askUserTool.promptSnippet).toContain('ask_user');
    expect(Array.isArray(askUserTool.promptGuidelines)).toBe(true);
  });

  it('has valid TypeBox parameters schema', () => {
    expect(askUserTool.parameters).toBeDefined();
    expect(askUserTool.parameters.properties).toHaveProperty('title');
    expect(askUserTool.parameters.properties).toHaveProperty('questions');
  });

  it('executes and returns terminate confirmation result', async () => {
    const params = {
      title: 'Select framework',
      questions: [
        {
          id: 'framework',
          label: 'Which framework do you prefer?',
          options: ['Svelte', 'React', 'Vue'],
          allowFreeText: false,
        },
      ],
    };

    const result = await askUserTool.execute(
      'call-123',
      params,
      new AbortController().signal,
      () => {},
      {} as never,
    );

    expect(result.terminate).toBe(true);
    expect(result.details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type !== 'text') {
      throw new Error('Expected a text confirmation.');
    }
    expect(content.text).toContain('Interactive prompt "Select framework" sent to user.');
  });
});
