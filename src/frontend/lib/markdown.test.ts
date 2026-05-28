import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders markdown and removes unsafe script tags', () => {
    const output = renderMarkdown('**Hello** <script>alert(1)</script> world');

    expect(output).toContain('<strong>Hello</strong>');
    expect(output).not.toContain('<script');
    expect(output).toContain('world');
  });
});