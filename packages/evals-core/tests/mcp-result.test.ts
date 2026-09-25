import { describe, it, expect } from 'vitest';
import { unwrapMcpContent } from '../src/runners/mcp-result.js';

describe('unwrapMcpContent', () => {
  describe('scalar inputs', () => {
    it('returns a string unchanged', () => {
      expect(unwrapMcpContent('{"applications":[]}')).toBe('{"applications":[]}');
    });

    it('does NOT parse a string looking for an envelope inside it', () => {
      // Deliberate boundary: the helper is structural only. A runner whose SDK
      // hands us an already-flattened string (gemini-cli, copilot) is trusted.
      const encoded = '{"content":[{"type":"text","text":"inner"}]}';
      expect(unwrapMcpContent(encoded)).toBe(encoded);
    });

    it('maps null and undefined to the empty string', () => {
      expect(unwrapMcpContent(null)).toBe('');
      expect(unwrapMcpContent(undefined)).toBe('');
    });
  });

  describe('codex shape — { content: ContentBlock[] } envelope', () => {
    it('returns the inner text of a single text block', () => {
      const payload = '{"applications":[{"client_id":"abc"}]}';
      const result = unwrapMcpContent({ content: [{ type: 'text', text: payload }] });
      expect(result).toBe(payload);
    });

    it('produces a string a grader can JSON.parse straight to the domain payload', () => {
      // This is the assertion that encodes issue #24: the envelope is valid JSON,
      // so JSON.parse succeeded before the fix — it just yielded the wrong object.
      const result = unwrapMcpContent({
        content: [{ type: 'text', text: '{"applications":[{"client_id":"abc"}]}' }],
      });
      const parsed = JSON.parse(result) as { applications?: unknown };
      expect(parsed.applications).toEqual([{ client_id: 'abc' }]);
    });

    it('accepts a block carrying `text` with no `type` marker', () => {
      // Not hypothetical: this is the fixture shape already used by
      // packages/evals/tests/runners/codex-agent.test.ts.
      expect(unwrapMcpContent({ content: [{ text: 'Auth0 quickstart guide' }] })).toBe('Auth0 quickstart guide');
    });

    it('ignores _meta and structured_content siblings', () => {
      const result = unwrapMcpContent({
        content: [{ type: 'text', text: 'body' }],
        _meta: { trace: 'x' },
        structured_content: { body: true },
      });
      expect(result).toBe('body');
    });
  });

  describe('claude-code shape — bare content block array', () => {
    it('returns the inner text of a single text block', () => {
      expect(unwrapMcpContent([{ type: 'text', text: 'body' }])).toBe('body');
    });

    it('joins several text blocks with a newline and trims', () => {
      expect(
        unwrapMcpContent([
          { type: 'text', text: '  first' },
          { type: 'text', text: 'second  ' },
        ]),
      ).toBe('first\nsecond');
    });

    it('accepts bare string elements, which the runner has always tolerated', () => {
      expect(unwrapMcpContent(['first', 'second'])).toBe('first\nsecond');
      expect(unwrapMcpContent(['bare', { type: 'text', text: 'block' }])).toBe('bare\nblock');
    });

    it('keeps only text blocks when the result mixes media in', () => {
      const result = unwrapMcpContent([
        { type: 'text', text: 'caption' },
        { type: 'image', source: { type: 'base64', data: 'iVBOR', media_type: 'image/png' } },
      ]);
      expect(result).toBe('caption');
    });
  });

  describe('fallback — anything not recognised as content blocks is stringified', () => {
    it('falls back for an envelope whose blocks carry no text at all', () => {
      // Returning '' here would silently drop the only record of the call.
      const envelope = {
        content: [{ type: 'image', source: { type: 'base64', data: 'iVBOR', media_type: 'image/png' } }],
      };
      expect(unwrapMcpContent(envelope)).toBe(JSON.stringify(envelope));
    });

    it('falls back for an empty content array', () => {
      expect(unwrapMcpContent({ content: [] })).toBe(JSON.stringify({ content: [] }));
    });

    it('preserves a domain payload whose `content` is a string', () => {
      // An Action's source code is the realistic case. Mistaking it for an
      // envelope would corrupt the field graders read.
      const action = { id: 'act_1', content: 'exports.onExecutePostLogin = async () => {};' };
      expect(unwrapMcpContent(action)).toBe(JSON.stringify(action));
    });

    it('preserves a domain payload whose `content` is an array of non-block objects', () => {
      const page = { content: [{ id: 'a' }, { id: 'b' }] };
      expect(unwrapMcpContent(page)).toBe(JSON.stringify(page));
    });

    it('preserves a domain payload whose `content` elements carry `type` but no text', () => {
      // Block-shaped enough to be recognised, but there is no text to extract —
      // stringifying keeps the data rather than collapsing it to ''.
      const connections = { content: [{ type: 'auth0', name: 'Username-Password-Authentication' }] };
      expect(unwrapMcpContent(connections)).toBe(JSON.stringify(connections));
    });

    it('preserves a domain payload that has no `content` key', () => {
      const payload = { applications: [{ client_id: 'abc' }] };
      expect(unwrapMcpContent(payload)).toBe(JSON.stringify(payload));
    });

    it('falls back for an array whose elements are not content blocks', () => {
      expect(unwrapMcpContent([{ client_id: 'abc' }])).toBe(JSON.stringify([{ client_id: 'abc' }]));
    });

    it('stringifies numbers and booleans', () => {
      expect(unwrapMcpContent(42)).toBe('42');
      expect(unwrapMcpContent(true)).toBe('true');
    });
  });
});
