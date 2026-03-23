/**
 * Tests for src/run.ts
 */

import { describe, it, expect } from 'vitest';
import { extractCodeBlocks, DEFAULT_MODEL } from '../run.js';

describe('DEFAULT_MODEL', () => {
  it('is gpt-5.2', () => {
    expect(DEFAULT_MODEL).toBe('gpt-5.2');
  });
});

describe('extractCodeBlocks', () => {
  it('extracts a single block', () => {
    const text = 'Some prose.\n```js\nconst x = 1;\n```\nMore prose.';
    expect(extractCodeBlocks(text)).toBe('const x = 1;\n');
  });

  it('extracts multiple blocks', () => {
    const text = 'Intro.\n```js\nconst a = 1;\n```\nMiddle.\n```jsx\nconst b = 2;\n```\nEnd.';
    const result = extractCodeBlocks(text);
    expect(result).toContain('const a = 1;');
    expect(result).toContain('const b = 2;');
    expect(result).not.toContain('Intro');
    expect(result).not.toContain('Middle');
    expect(result).not.toContain('End');
  });

  it('strips surrounding prose', () => {
    const text = 'You should use Auth0Provider here.\n```jsx\nconst x = 1;\n```\nHope that helps!';
    const result = extractCodeBlocks(text);
    expect(result).not.toContain('Auth0Provider');
    expect(result).not.toContain('Hope that helps');
  });

  it('falls back to full text when no blocks', () => {
    const text = 'Just plain text with no fences.';
    expect(extractCodeBlocks(text)).toBe(text);
  });

  it('keyword in prose only not found', () => {
    const text =
      'Make sure to call loginWithRedirect when the user clicks login.\n```jsx\nfunction App() { return <div />; }\n```';
    const result = extractCodeBlocks(text);
    expect(result).not.toContain('loginWithRedirect');
  });

  it('keyword in code block is found', () => {
    const text = 'Here is how:\n```jsx\nloginWithRedirect();\n```';
    const result = extractCodeBlocks(text);
    expect(result).toContain('loginWithRedirect');
  });

  it('block without language tag', () => {
    const text = '```\nplain code\n```';
    expect(extractCodeBlocks(text)).toBe('plain code\n');
  });

  it('block with complex language tag', () => {
    for (const tag of ['objective-c', 'c++', 'text.html', 'c#', 'bash linenos']) {
      const text = `\`\`\`${tag}\nsome code\n\`\`\``;
      expect(extractCodeBlocks(text), `failed for tag: ${tag}`).toBe('some code\n');
    }
  });

  it('handles Windows line endings', () => {
    const text = '```js\r\nconst x = 1;\r\n```';
    expect(extractCodeBlocks(text)).toContain('const x = 1;');
  });

  it('empty block returns empty string', () => {
    const text = '```\n```';
    const result = extractCodeBlocks(text);
    expect(result).toBe('');
  });

  it('prose only response unchanged', () => {
    const text = 'import Auth0\nAuth0.webAuth(clientId: x, domain: y)';
    expect(extractCodeBlocks(text)).toBe(text);
  });

  it('unterminated fence does not scan prose', () => {
    const text =
      'Make sure to call loginWithRedirect when the user clicks login.\n```jsx\nfunction App() { return <div />; }';
    const result = extractCodeBlocks(text);
    expect(result).not.toContain('loginWithRedirect');
  });
});
