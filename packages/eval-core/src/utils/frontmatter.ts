/**
 * Shared YAML-ish frontmatter parser.
 *
 * Extracts key-value pairs from the `---` delimited block at the start
 * of a markdown file. Handles CRLF line endings.
 */

/**
 * Parses frontmatter from a markdown string and returns the metadata
 * plus the remaining text with frontmatter stripped.
 *
 * Normalises `\r\n` → `\n` before matching so Windows-encoded files work.
 */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const normalised = text.replace(/\r\n/g, '\n');
  const meta: Record<string, string> = {};

  const match = normalised.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match?.[1]) return { meta, body: normalised };

  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const k = line.slice(0, colonIdx).trim();
      const v = line.slice(colonIdx + 1).trim();
      meta[k] = v;
    }
  }

  const body = normalised.slice(match[0]!.length);
  return { meta, body };
}
