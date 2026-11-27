/**
 * LLM judge grader executor.
 *
 * Handles: judge.
 */

import type { GraderDef, GraderResult, EventToolCall } from '@a0/evals-graders';
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
 * Render the agent's successful shell commands as a judge-input section. Used
 * only when a judge opts in via `input: 'trace' | 'both'` — for evals whose artifact
 * is CLI invocations (no files to inspect). Errored calls are dropped so the
 * judge sees the commands that actually took effect.
 *
 * Credential values are masked before the trace leaves the machine, and the marker
 * left behind is what a security judge reads: it says a secret occupied that
 * position without sending the value to the proxy.
 *
 * The header spells out two properties of this format, because a judge that has to
 * infer them gets them wrong: every listed command exited 0, and command output is
 * not shown. A judge asked to confirm an end state read a later command re-declaring
 * an id literal as evidence the agent had fabricated it, when it was the id the
 * previous command printed, carried across a shell boundary.
 */
export function formatCommandTrace(toolCalls: EventToolCall[]): string {
  const commands = toolCalls
    .filter((tc) => RUN_COMMAND_NAMES.has(tc.name) && !tc.causedError)
    .map((tc) => redactSecrets(String(tc.args.command ?? '').trim()))
    .filter((cmd) => cmd.length > 0);
  if (commands.length === 0) return '';
  const header =
    '// COMMAND TRACE (shell commands the agent ran). Every command listed here exited\n' +
    '// successfully — failed commands are omitted. Their output is NOT captured, so the\n' +
    '// absence of output is not evidence a command did nothing. Each command runs in its\n' +
    '// own shell, so an id assigned as a literal in a later command is a value read from\n' +
    "// an earlier command's output, not a fabricated one.";
  return `${header}\n${commands.join('\n')}`;
}

/** What a judge reads to answer its question, as the grader def selects it. */
export interface JudgeEvidence {
  /** Files, command trace and agent reply joined into the text sent to the judge as `code`. */
  text: string;
  /** Workspace files included in `text`, after {@link isJudgeExcluded}, in order. */
  files: [path: string, content: string][];
}

/**
 * Builds the evidence a judge reads from the run's files, command trace and final reply.
 * The executor and an offline regrade share it, so a regrade passes `buildJudgeRequest`
 * the same text the original judge was sent and gets the same `judgeInputHash`.
 *
 * Returns `undefined` for a trace-only judge when the agent ran no commands: there is
 * nothing to evaluate.
 */
export function buildJudgeEvidence(
  def: GraderDef,
  ctx: Pick<GraderContext, 'files' | 'toolCalls' | 'agentText'>,
): JudgeEvidence | undefined {
  const source = def.source ?? 'files';
  // `includeCommandTrace` is the deprecated alias, honoured for defs built without `input`.
  const input = def.input ?? (def.includeCommandTrace ? 'both' : 'files');
  const includeFiles = source !== 'response' && input !== 'trace';
  const includeAgentReply = (source === 'response' || source === 'both') && ctx.agentText.length > 0;

  const files = includeFiles ? Object.entries(ctx.files).filter(([k]) => !isJudgeExcluded(k)) : [];
  const fileText = files.map(([k, v]) => `// FILE: ${k}\n${v}`).join('\n\n');

  // For CLI-only evals the artifact is the command trace, not files. When the
  // judge opts in, append it so there is content to evaluate; otherwise the
  // judge sees only files (unchanged behaviour for every existing judge).
  const traceText = input !== 'files' ? formatCommandTrace(ctx.toolCalls ?? []) : '';
  if (input === 'trace' && traceText.length === 0) return undefined;

  // For MCP-only evals the agent never writes files — include the agent's final
  // reply only when the grader explicitly opts in via source: 'response' | 'both'.
  const agentReplyText = includeAgentReply ? `// AGENT REPLY:\n${ctx.agentText}` : '';

  const text = [fileText, traceText, agentReplyText].filter((s) => s.length > 0).join('\n\n');
  return { text, files };
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

    // A trace-only judge with no trace has nothing to evaluate; fail rather than
    // let the judge rule on empty input.
    const evidence = buildJudgeEvidence(def, ctx);
    if (!evidence) {
      return {
        name: def.name,
        kind: def.kind,
        passed: false,
        detail: 'no command trace available for judge',
        level: def.level,
      };
    }
    const { text: judgeText, files: judgeEntries } = evidence;

    logger.info(`[judge] ${judgeEntries.length} files, ${judgeText.length} chars total (limit: ${maxCodeChars})`);
    for (const [k, v] of judgeEntries) {
      logger.info(`[judge]   ${k} (${v.length} chars)`);
    }
    if (judgeText.length > maxCodeChars) {
      logger.warn(`[judge] WARNING: content exceeds limit (${judgeText.length} > ${maxCodeChars} chars)`);
    }

    const { passed, detail, inputTokens, outputTokens, judgeInputHash } = await llmJudge({
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
      judgeInputHash,
    };
  },
};
