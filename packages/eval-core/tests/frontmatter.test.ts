import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../src/utils/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses simple key-value pairs', () => {
    const { meta, body } = parseFrontmatter('---\nid: my_eval\nname: My Eval\n---\n\n## Task\nDo something.\n');
    expect(meta).toEqual({ id: 'my_eval', name: 'My Eval' });
    expect(body).toBe('\n## Task\nDo something.\n');
  });

  it('returns empty meta and full body when no frontmatter', () => {
    const text = '## Task\nDo something.\n';
    const { meta, body } = parseFrontmatter(text);
    expect(meta).toEqual({});
    expect(body).toBe(text);
  });

  it('normalises CRLF line endings', () => {
    const { meta } = parseFrontmatter('---\r\nid: crlf_eval\r\nname: CRLF\r\n---\r\n\r\nbody\r\n');
    expect(meta).toEqual({ id: 'crlf_eval', name: 'CRLF' });
  });

  it('preserves colons in values', () => {
    const { meta } = parseFrontmatter('---\nurl: https://example.com\n---\n\nbody\n');
    expect(meta.url).toBe('https://example.com');
  });

  it('produces empty string for key with empty value', () => {
    const { meta } = parseFrontmatter('---\nid:\nname: Test\n---\n\nbody\n');
    expect(meta.id).toBe('');
    expect(meta.name).toBe('Test');
  });

  it('strips body from frontmatter', () => {
    const { body } = parseFrontmatter('---\nid: test\n---\nRemaining content.\n');
    expect(body).toBe('Remaining content.\n');
  });

  it('returns empty meta when frontmatter block is empty', () => {
    const text = '---\n\n---\n\nbody\n';
    const { meta, body } = parseFrontmatter(text);
    // Empty block doesn't match regex (requires content between delimiters)
    expect(meta).toEqual({});
    expect(body).toBe(text);
  });

  it('ignores lines without colons in frontmatter', () => {
    const { meta } = parseFrontmatter('---\nid: test\nno-colon-here\nname: Eval\n---\n\nbody\n');
    expect(meta).toEqual({ id: 'test', name: 'Eval' });
  });

  it('trims whitespace from keys and values', () => {
    const { meta } = parseFrontmatter('---\n  id  :  spaced_eval  \n---\n\nbody\n');
    expect(meta.id).toBe('spaced_eval');
  });
});
