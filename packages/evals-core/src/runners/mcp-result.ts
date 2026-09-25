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
 * Routing all of them through this helper is what keeps the contract true. The
 * alternative — each runner unwrapping for itself — is what produced the bug
 * this exists to prevent: `codex` stringified the whole envelope, so
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
 * Recognition is deliberately narrow on both ends. Every element must look like
 * a content block — carrying text, or a string `type` for the media blocks that
 * sit alongside one — so a domain payload that merely happens to have a
 * `content` key (an Action's source, a paginated list) is not mistaken for an
 * envelope. And at least one element must actually carry text, so an image-only
 * result falls through to the JSON fallback rather than unwrapping to the empty
 * string and losing the only record of the call.
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
  if (isObject(result) && isContentBlockArray(result.content)) return joinText(result.content);

  return JSON.stringify(result);
}
