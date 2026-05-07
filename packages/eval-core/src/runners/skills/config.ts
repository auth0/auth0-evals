import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

import type { SkillsConfig, RemoteSkillRepo } from '../../config/framework.js';
import { resolveInside } from '../../workspace/index.js';
import { getFrameworkConfig } from '../../config/framework-config.js';
import { logger } from '../../utils/logger.js';

/**
 * SkillsManager — resolves skill directories from multiple local dirs and
 * remote repos, cloning/pulling remotes on demand.
 *
 * Resolution order: local directories first (in config order), then remote
 * repos (in config order). First match wins.
 */
export class SkillsManager {
  readonly localDirs: string[];
  readonly remoteRepos: RemoteSkillRepo[];
  private readonly clonePromises = new Map<string, Promise<boolean>>();

  constructor(config: SkillsConfig) {
    this.localDirs = (config.localDirs ?? []).map((d) => resolve(d));
    this.remoteRepos = config.remoteRepos ?? [];
  }

  /**
   * Clone/pull all configured remote repos. Idempotent per repo entry (keyed by
   * url + clone directory). Note: despite Promise.all, clones execute sequentially
   * because doCloneRepo uses execFileSync. This is intentional — synchronous git
   * keeps error handling simple and avoids the concurrency issues documented in
   * ensureRepoCloned. Returns true if at least one repo was cloned/pulled successfully.
   */
  async ensureAllCloned(): Promise<boolean> {
    if (this.remoteRepos.length === 0) return true;
    const results = await Promise.all(this.remoteRepos.map((repo) => this.ensureRepoCloned(repo)));
    return results.some((r) => r);
  }

  /**
   * Resolve a skill name to its directory path.
   * Checks local dirs first, then remote repo skill bases — all in config order.
   * Returns null if the skill is not found.
   * Throws on path traversal attempts.
   */
  resolveSkillDir(skill: string): string | null {
    // Local directories first
    for (const dir of this.localDirs) {
      const candidate = resolveInside(dir, skill);
      if (existsSync(candidate)) return candidate;
    }

    // Remote repo skill bases
    for (const repo of this.remoteRepos) {
      const base = this.getRepoSkillsBase(repo);
      const candidate = resolveInside(base, skill);
      if (existsSync(candidate)) return candidate;
    }

    return null;
  }

  /**
   * Get all search paths in resolution order (for error messages).
   */
  getSearchPaths(): string[] {
    const paths: string[] = [];
    for (const dir of this.localDirs) {
      paths.push(dir);
    }
    for (const repo of this.remoteRepos) {
      paths.push(this.getRepoSkillsBase(repo));
    }
    return paths;
  }

  /**
   * Get the clone directory for a remote repo.
   * When localPath is not specified, derives a unique directory name from the
   * repo URL to prevent multiple repos from colliding in the same directory.
   */
  getRepoCloneDir(repo: RemoteSkillRepo): string {
    if (repo.localPath) return resolve(repo.localPath);
    // Derive a stable unique name from the URL: "github.com/org/repo.git" → "org-repo"
    const slug = repo.url
      .replace(/.*:\/\//, '') // strip protocol (https://...)
      .replace(/^[^@]+@[^:]+:/, '') // strip SSH prefix (git@host:)
      .replace(/\.git$/, '') // strip .git suffix
      .split('/')
      .slice(-2) // take org/repo
      .join('-');
    return resolve(`skills-remote/${slug}`);
  }

  /**
   * Get the skills base directory (clone dir + skillsPath) for a remote repo.
   * Uses resolveInside to prevent skillsPath from escaping the clone directory.
   */
  private getRepoSkillsBase(repo: RemoteSkillRepo): string {
    const cloneDir = this.getRepoCloneDir(repo);
    const skillsPath = repo.skillsPath ?? '.';
    return resolveInside(cloneDir, skillsPath);
  }

  /**
   * Ensure a single remote repo is cloned/pulled. Idempotent per repo entry
   * (keyed by url + clone directory, so the same URL with different localPath
   * values is treated as separate entries).
   * Note: retry-on-failure works because doCloneRepo uses execFileSync, so the
   * promise settles synchronously within the same microtask. If git operations
   * are ever made async, this deduplication logic needs a lock to prevent
   * concurrent clones between the .then() deletion and the next caller.
   */
  private ensureRepoCloned(repo: RemoteSkillRepo): Promise<boolean> {
    const key = `${repo.url}|${this.getRepoCloneDir(repo)}`;
    let promise = this.clonePromises.get(key);
    if (!promise) {
      promise = this.doCloneRepo(repo).then(({ available, fresh }) => {
        // Allow retry when clone failed or update failed (stale fallback)
        if (!fresh) this.clonePromises.delete(key);
        return available;
      });
      this.clonePromises.set(key, promise);
    }
    return promise;
  }

  private static readonly GIT_TIMEOUT_MS = 30_000;
  private static readonly ALLOWED_URL_PREFIXES = ['https://', 'ssh://', 'git@'];
  private static readonly INVALID_BRANCH_PATTERN = /[\s:]/;

  /**
   * Normalize and validate a branch name. Strips an optional `refs/heads/` prefix,
   * rejects values containing whitespace or `:` (refspec mapping), rejects
   * values starting with `-` (could be misinterpreted as git options), and rejects
   * other `refs/` prefixes (e.g. `refs/tags/`) which would conflict with the
   * `refs/heads/` prefix used in fetch refspecs.
   * Returns the normalized branch name or null if invalid.
   */
  private normalizeBranch(branch: string): string | null {
    // Trim and strip optional refs/heads/ prefix to avoid refs/heads/refs/heads/...
    const normalized = branch.trim().replace(/^refs\/heads\//, '');
    if (
      !normalized ||
      normalized.startsWith('-') ||
      normalized.startsWith('refs/') ||
      SkillsManager.INVALID_BRANCH_PATTERN.test(normalized)
    ) {
      logger.error(`[skills] Refusing invalid branch name: "${branch}"`);
      return null;
    }
    return normalized;
  }

  /**
   * Validate that a clone directory is safe for rmSync. Rejects:
   * - root or near-root paths
   * - paths with fewer than 3 segments (e.g. "/tmp", "/home/user")
   */
  private isCloneDirSafe(cloneDir: string): boolean {
    if (!cloneDir || cloneDir === '/' || cloneDir === dirname(cloneDir)) return false;
    // Require at least 3 path segments to avoid deleting high-level directories.
    // Split on both separators for cross-platform safety.
    const segments = resolve(cloneDir).split(/[\\/]/).filter(Boolean);
    if (segments.length < 3) return false;
    return true;
  }

  private async doCloneRepo(repo: RemoteSkillRepo): Promise<{ available: boolean; fresh: boolean }> {
    const cloneDir = this.getRepoCloneDir(repo);
    if (!this.isCloneDirSafe(cloneDir)) {
      logger.error(`[skills] Refusing to operate on unsafe clone directory: "${cloneDir}"`);
      return { available: false, fresh: false };
    }
    if (!SkillsManager.ALLOWED_URL_PREFIXES.some((p) => repo.url.startsWith(p))) {
      logger.error(`[skills] Refusing untrusted URL scheme: "${repo.url}"`);
      return { available: false, fresh: false };
    }
    const opts = { stdio: 'pipe' as const, timeout: SkillsManager.GIT_TIMEOUT_MS };
    const branch = repo.branch !== undefined ? this.normalizeBranch(repo.branch) : null;
    if (repo.branch !== undefined && !branch) {
      return { available: false, fresh: false };
    }
    const hadExistingClone = existsSync(join(cloneDir, '.git'));
    try {
      if (hadExistingClone) {
        // fetch+reset is more reliable than pull for shallow clones
        const fetchArgs = ['fetch', '--depth', '1', 'origin'];
        if (branch) fetchArgs.push('--', `refs/heads/${branch}`);
        execFileSync('git', fetchArgs, { ...opts, cwd: cloneDir });
        execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { ...opts, cwd: cloneDir });
      } else {
        if (existsSync(cloneDir)) {
          rmSync(cloneDir, { recursive: true, force: true });
        }
        mkdirSync(dirname(cloneDir), { recursive: true });
        const cloneArgs = ['clone', '--depth', '1'];
        if (branch) cloneArgs.push('--branch', branch);
        cloneArgs.push(repo.url, cloneDir);
        execFileSync('git', cloneArgs, opts);
      }
      return { available: true, fresh: true };
    } catch (e) {
      if (hadExistingClone) {
        // Update failed but stale clone is still usable for skill resolution
        logger.warn(`[skills] Failed to update ${repo.url} — using existing (possibly stale) checkout`);
        return { available: true, fresh: false };
      }
      logger.error(`[skills] Failed to clone ${repo.url} —`, e instanceof Error ? (e.stack ?? e.message) : String(e));
      return { available: false, fresh: false };
    }
  }
}

// ── Module-level singleton ───────────────────────────────────────────────────

let _manager: SkillsManager | undefined;

/**
 * Get or create the SkillsManager singleton (lazy-initialized from framework config).
 */
export function getSkillsManager(): SkillsManager {
  if (!_manager) {
    const config = getFrameworkConfig();
    _manager = new SkillsManager(config.skills);
  }
  return _manager;
}

/**
 * Reset the singleton (for testing).
 */
export function resetSkillsManager(): void {
  _manager = undefined;
}
