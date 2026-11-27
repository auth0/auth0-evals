/**
 * LLM judge grader executor.
 *
 * Handles: judge.
 */

import type { GraderDef, GraderResult, EventToolCall, TraceCommands } from '@a0/evals-graders';
import type { GraderContext, GraderExecutor } from './types.js';
import { llmJudge } from '../llm-judge.js';
import { logger } from '../../utils/logger.js';
import { redactSecrets } from '../../utils/redact.js';

/**
 * File patterns (matched against the basename) excluded from the LLM judge input.
 *
 * `tsconfig*.json` / `angular.json` are dropped to save token budget. `.env*` files
 * are dropped so credential values never reach the judge LLM — security graders verify
 * secret absence in source deterministically via `notContainsInSource`, and "wired into
 * .env" is an event-based (`wroteFile`) concern, so the judge never needs `.env` content.
 *
 * `.md` / `.txt` files are dropped because agents routinely emit large standalone docs
 * (integration guides, summaries, checklists) that are not source code. They inflate the
 * corpus — sometimes past `maxCodeChars`, which fails the judge outright — while adding no
 * signal the judge needs.
 *
 * Binaries and generated native project files are dropped for the same reason: the workspace
 * walker reads every file as UTF-8, so a bare React Native scaffold otherwise feeds the judge
 * `gradle-wrapper.jar` and the launcher PNGs as mojibake — ~115KB of its ~172KB corpus, which
 * pushed it 5x past `maxCodeChars`. Note that `.plist`, `.xml`, and `.gradle` are deliberately
 * NOT excluded: judges assert on `Info.plist` (CFBundleURLTypes), `AndroidManifest.xml`, and
 * `app/build.gradle` (manifestPlaceholders).
 */
const JUDGE_EXCLUDED_PATTERNS = [
  /^tsconfig(\.\w+)?\.json$/,
  /^angular\.json$/,
  /^tsconfig\.tsbuildinfo$/,
  /\.md$/i,
  /\.txt$/i,
  /^\.env(\..*)?$/,
  /\.(?:jar|png|jpe?g|gif|ico|webp|svg|ttf|otf|woff2?|keystore|jks)$/i,
  /\.(?:pbxproj|storyboard|xib|xcscheme|xcworkspacedata|lock)$/i,
  /^gradlew(\.bat)?$/,
];

/** Directory paths (matched against the relative path) excluded from the LLM judge input — large Android build artifacts. */
const JUDGE_EXCLUDED_DIRS = ['.gradle', 'app/build'];

export function isJudgeExcluded(relPath: string): boolean {
  const basename = relPath.split('/').pop()!;
  if (JUDGE_EXCLUDED_PATTERNS.some((p) => p.test(basename))) return true;
  return JUDGE_EXCLUDED_DIRS.some((dir) => relPath === dir || relPath.startsWith(dir + '/'));
}

// Tool names that represent shell execution across runners (Claude: run_command, Gemini: bash).
const RUN_COMMAND_NAMES = new Set(['run_command', 'bash']);

/**
 * Render the agent's shell commands as a judge-input section. Used only when a
 * judge opts in via `input: 'trace' | 'both'` — for evals whose artifact is CLI
 * invocations (no files to inspect).
 *
 * `mode` controls which commands appear:
 * - `'succeeded'` (default): only commands the runner reported as successful, so the
 *   judge sees the commands that actually took effect. Failed commands are omitted.
 * - `'all'`: every command in original order, with failed ones prefixed `[FAILED] `,
 *   for judges that must see failed attempts (e.g. to penalise a failed-then-abandoned
 *   step or confirm a retry).
 *
 * `causedError` is each runner's own failure signal: Claude tool `is_error`, Codex
 * non-zero `exit_code`, Gemini `status !== 'success'` / cancelled, Copilot
 * `success !== true`; calls with no result (orphaned) count as failed.
 *
 * Credential values are masked before the trace leaves the machine, and the marker
 * left behind is what a security judge reads: it says a secret occupied that
 * position without sending the value to the proxy.
 *
 * The header spells out two properties of this format, because a judge that has to
 * infer them gets them wrong: which commands are listed (and how failures are shown),
 * and that command output is not shown. A judge asked to confirm an end state read a
 * later command re-declaring an id literal as evidence the agent had fabricated it,
 * when it was the id the previous command printed, carried across a shell boundary.
 */
export function formatCommandTrace(toolCalls: EventToolCall[], mode: TraceCommands = 'succeeded'): string {
  const commands = toolCalls
    .filter((tc) => RUN_COMMAND_NAMES.has(tc.name) && (mode === 'all' || !tc.causedError))
    .map((tc) => ({ text: redactSecrets(String(tc.args.command ?? '').trim()), failed: tc.causedError === true }))
    .filter((cmd) => cmd.text.length > 0)
    .map((cmd) => (mode === 'all' && cmd.failed ? `[FAILED] ${cmd.text}` : cmd.text));
  if (commands.length === 0) return '';
  const header =
    mode === 'all'
      ? '// COMMAND TRACE (every shell command the agent ran, in order). A command prefixed [FAILED]\n' +
        "// was reported as failed by the agent's runner (non-zero exit, tool error, timeout/\n" +
        '// cancellation, or no result) and may have had no effect; unprefixed commands were reported\n' +
        '// as successful. Output is NOT captured, so the absence of output is not evidence a command\n' +
        '// did nothing. Each command runs in its own shell, so an id assigned as a literal in a later\n' +
        "// command is a value read from an earlier command's output, not a fabricated one."
      : "// COMMAND TRACE (shell commands the agent ran, in order). Only commands the agent's\n" +
        '// runner reported as successful are listed — commands it reported as failed (non-zero\n' +
        '// exit, tool error, timeout/cancellation, or no result) are omitted. Their output is NOT\n' +
        '// captured, so the absence of output is not evidence a command did nothing. Each command\n' +
        '// runs in its own shell, so an id assigned as a literal in a later command is a value read\n' +
        "// from an earlier command's output, not a fabricated one.";
  return `${header}\n${commands.join('\n')}`;
}

export const llmJudgeExecutor: GraderExecutor = {
  kind: 'judge',

  async execute(def: GraderDef, ctx: GraderContext): Promise<GraderResult> {
    if (!ctx.apiKey || !ctx.judge) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'Judge grader requires apiKey and judge configuration in context',
        level: def.level,
      };
    }

    const { model, baseUrl, maxTokens, maxCodeChars, enforceMaxChars } = ctx.judge;

    const source = def.source ?? 'files';
    // `includeCommandTrace` is the deprecated alias, honoured for defs built without `input`.
    const input = def.input ?? (def.includeCommandTrace ? 'both' : 'files');
    const includeFiles = source !== 'response' && input !== 'trace';
    const includeAgentReply = (source === 'response' || source === 'both') && ctx.agentText.length > 0;

    const judgeEntries = includeFiles ? Object.entries(ctx.files).filter(([k]) => !isJudgeExcluded(k)) : [];
    const fileText = judgeEntries.map(([k, v]) => `// FILE: ${k}\n${v}`).join('\n\n');

    // For CLI-only evals the artifact is the command trace, not files. When the
    // judge opts in, append it so there is content to evaluate; otherwise the
    // judge sees only files (unchanged behaviour for every existing judge).
    const traceText =
      input !== 'files' ? formatCommandTrace(ctx.toolCalls ?? [], def.traceCommands ?? 'succeeded') : '';

    // A trace-only judge with no trace has nothing to evaluate; fail rather than
    // let the judge rule on empty input.
    if (input === 'trace' && traceText.length === 0) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'no command trace available for judge',
        level: def.level,
      };
    }

    // For MCP-only evals the agent never writes files — include the agent's final
    // reply only when the grader explicitly opts in via source: 'response' | 'both'.
    const agentReplyText = includeAgentReply ? `// AGENT REPLY:\n${ctx.agentText}` : '';

    const judgeText = [fileText, traceText, agentReplyText].filter((s) => s.length > 0).join('\n\n');

    logger.info(`[judge] ${judgeEntries.length} files, ${judgeText.length} chars total (limit: ${maxCodeChars})`);
    for (const [k, v] of judgeEntries) {
      logger.info(`[judge]   ${k} (${v.length} chars)`);
    }
    if (judgeText.length > maxCodeChars) {
      logger.warn(`[judge] WARNING: content exceeds limit (${judgeText.length} > ${maxCodeChars} chars)`);
    }

    const { passed, detail, inputTokens, outputTokens } = await llmJudge({
      question: def.question!,
      context: def.context,
      code: judgeText,
      apiKey: ctx.apiKey,
      model,
      baseUrl,
      maxTokens,
      enforceMaxChars,
      maxCodeChars,
    });

    return {
      name: def.name,
      kind: def.kind,
      passed,
      detail,
      level: def.level,
      inputTokens,
      outputTokens,
      judgeModel: model,
    };
  },
};
