/**
 * Runner-independent normalisation of an MCP tool result into `ToolCallRecord.result`.
 *
 * Graders read `tc.result` as a documented contract — they `JSON.parse` it and
 * pull out a domain field — so every runner must record the same string for the
 * same tool response. Each agent SDK hands us a different shape:
 *
 *   claude-code   tool_result.content   string | ContentBlock[]
 *   codex         item.result           { content: ContentBlock[], structured_content, _meta? }
 *   gemini-cli    event.output          string (already flattened by the CLI)
 *   copilot       result.content        string (already flattened by the SDK)
 *
 * The first two need flattening and call this helper; the last two are already
 * flat and record their string as-is. Having one implementation for the runners
 * that do need it is what keeps the contract true. The alternative — each
 * unwrapping for itself — is what produced the bug this exists to prevent:
 * `codex` stringified the whole envelope, so
 * `tc.result` was `{"content":[{"type":"text","text":"{\"applications\":…"}]}`
 * where `claude-code` had `{"applications":…}`. `JSON.parse` *succeeded* on the
 * envelope, so a grader reading `.applications` got `undefined`, returned false
 * before inspecting the trace, and the run was reported as a model regression.
 */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The text a single `content[]` entry contributes, or `null` if it carries none.
 *
 * A bare string counts: the Anthropic SDK types a tool_result's content as
 * `string | Array<TextBlockParam | ImageBlockParam>`, and the claude-code
 * runner has always tolerated loose string elements inside that array.
 */
function blockText(block: unknown): string | null {
  if (typeof block === 'string') return block;
  if (isObject(block) && typeof block.text === 'string') return block.text;
  return null;
}

/** Whether `block` is shaped like a content block at all, text-carrying or not. */
const isBlockShaped = (block: unknown): boolean =>
  blockText(block) !== null || (isObject(block) && typeof block.type === 'string');

/**
 * Whether `value` is an MCP `content[]` array we can extract text from.
 *
 * Every element must look like a content block — carrying text, or a string
 * `type` for the media blocks that sit alongside one — and at least one must
 * actually carry text, so an image-only result falls through to the JSON
 * fallback rather than unwrapping to the empty string and losing the only
 * record of the call.
 *
 * This says nothing about whether the *enclosing object* is an MCP result;
 * `isMcpResultEnvelope` decides that, because a text-bearing `content` array
 * alone is not sufficient evidence.
 */
function isContentBlockArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isBlockShaped) &&
    value.some((block) => blockText(block) !== null)
  );
}

/** Joins the text-carrying blocks, matching what claude-code has always recorded. */
const joinText = (blocks: unknown[]): string =>
  blocks
    .map(blockText)
    .filter((text): text is string => text !== null)
    .join('\n')
    .trim();

/**
 * Top-level keys the MCP spec allows on a `CallToolResult`, plus the snake_case
 * spelling codex's SDK uses for `structuredContent`.
 */
const MCP_RESULT_KEYS = new Set(['content', 'structuredContent', 'structured_content', 'isError', '_meta']);

/**
 * Whether `value` is an MCP tool-result envelope rather than a domain object
 * that merely happens to have a `content` array.
 *
 * Checking the *key set* — not just the presence of a text-bearing `content` —
 * is what makes this safe. A `CallToolResult` carries only `content`,
 * `structuredContent`, `isError` and `_meta`, so a payload like
 * `{ id: 'doc_1', content: [{ type: 'paragraph', text: 'hello' }] }` is rejected
 * on its `id` and survives intact. Guessing from block contents alone would
 * unwrap it to `"hello"` and silently drop every sibling field — the same class
 * of loss this module exists to prevent, just pointed the other way.
 */
function isMcpResultEnvelope(value: unknown): value is { content: unknown[] } {
  return (
    isObject(value) && isContentBlockArray(value.content) && Object.keys(value).every((key) => MCP_RESULT_KEYS.has(key))
  );
}

/**
 * Normalises an MCP tool result to the flat text body every grader expects.
 *
 * Note this is purely structural: a `string` input is returned untouched rather
 * than parsed in case it encodes an envelope. Tolerating a stringified envelope
 * is a consumer-side concern; a runner holds structured SDK data and is
 * responsible for unwrapping it here, which is what makes the cross-runner
 * parity test meaningful.
 *
 * @param result - The SDK's result value: a string, a bare content-block array,
 *                 an `{ content: [...] }` envelope, or any other payload.
 * @returns The unwrapped text, `''` for null/undefined, or `JSON.stringify` of
 *          anything not recognised as content blocks.
 */
export function unwrapMcpContent(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';

  // claude-code: the SDK hands over the block array directly.
  if (isContentBlockArray(result)) return joinText(result);

  // codex: the blocks are nested under `content`, beside structured_content/_meta.
  if (isMcpResultEnvelope(result)) return joinText(result.content);

  return JSON.stringify(result);
}
