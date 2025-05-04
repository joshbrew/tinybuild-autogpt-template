import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { SAVED_DIR } from './clientConfig.js';

const execP = promisify(exec);

/**
 * Initialize a Git repository in the given directory if not already present.
 * @param {string} dir - Path to the target Git directory (e.g., gpt_dev/saved).
 */
export async function ensureLocalRepo(dir) {
  const gitDir = path.join(dir, '.git');
  if (!fs.existsSync(gitDir)) {
    await execP('git init', { cwd: dir });
    await execP('git add .', { cwd: dir });
    await execP('git commit -m "🔖 initial AI-saved snapshot"', { cwd: dir });
  }
}

/**
 * Commit all current changes with a timestamped message.
 * If a remote is configured, also push to it.
 * @param {string} dir - Path to the Git repository.
 */
export async function commitGitSnapshot(dir) {
    try {
      // 1) Make sure .git exists
      await ensureLocalRepo(dir);
  
      // 2) Check for any changes (staged or not)
      const { stdout: status } = await execP('git status --porcelain', { cwd: dir });
      
      if (!status.trim()) {
        console.log('⚡ No changes detected in', dir, '– skipping commit.');
        return;
      }
  
      // 3) Stage everything and commit
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await execP('git add .', { cwd: dir });
      await execP(`git commit -m "🤖 AI run @ ${timestamp}"`, { cwd: dir });
  
      console.log(`⚡ Latest edits backed up in local git.`);
      // 4) If a remote exists, push
      const { stdout: remotes } = await execP('git remote', { cwd: dir });
      if (remotes.trim()) {
        // find current branch
        const { stdout: branch } = await execP(
          'git rev-parse --abbrev-ref HEAD',
          { cwd: dir }
        );
        const branchName = branch.trim();
        await execP(`git push -u origin ${branchName}`, { cwd: dir });
        console.log(`⚡ Pushed snapshot to origin/${branchName}`);
      }


    } catch (err) {
      console.warn('⚠️ Git snapshot failed:', err);
    }
  }
  

/**
 * List commit history on the current branch.
 * @param {string} dir - Repo directory.
 * @param {number} [maxCount] - Max commits to return.
 * @returns {Promise<string[]>} Array of "<sha> <message>" entries.
 */
export async function listVersions(dir, maxCount) {
  // no need to ensure repo here: listing branches/logs on non-git dir is an error
  const countFlag = maxCount ? `-n ${maxCount}` : '';
  const { stdout } = await execP(`git log --oneline ${countFlag}`, { cwd: dir });
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Get detailed changelog (diffs) for a commit or range.
 * @param {string} dir - Repo directory.
 * @param {string} ref - Commit SHA, branch name, or range.
 * @returns {Promise<string>} Full diff text.
 */
export async function getChangelog(dir, ref) {
  // assume repo exists
  const { stdout } = await execP(`git log -p ${ref}`, { cwd: dir });
  return stdout;
}

/**
 * List all local and remote branches.
 * @param {string} dir - Repo directory.
 * @returns {Promise<string[]>} Array of branch names.
 */
export async function listBranches(dir) {
  const { stdout } = await execP('git branch -a --format="%(refname:short)"', { cwd: dir });
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Create a new local branch or track a remote branch.
 * Failsafe: initialize repo if no remote.
 * @param {string} dir - Repo directory.
 * @param {string} branch - Name of the new branch.
 * @param {string} [remote] - Remote to track (e.g., 'origin').
 * @param {string} [startPoint='HEAD'] - Base commit for a local branch.
 */
export async function createBranch(dir, branch, remote, startPoint = 'HEAD') {
  if (!remote) {
    await ensureLocalRepo(dir);
    await execP(`git checkout -b ${branch} ${startPoint}`, { cwd: dir });
  } else {
    await execP(`git checkout -b ${branch} ${remote}/${branch}`, { cwd: dir });
  }
}

/**
 * Delete a branch locally or remotely.
 * Failsafe: init repo if deleting local and none exists.
 * @param {string} dir - Repo directory.
 * @param {string} branch - Branch name.
 * @param {string} [remote] - Remote name to delete from (if provided).
 * @param {boolean} [force=false] - Force delete local branch.
 */
export async function deleteBranch(dir, branch, remote, force = false) {
  if (!remote) {
    await ensureLocalRepo(dir);
    const flag = force ? '-D' : '-d';
    await execP(`git branch ${flag} ${branch}`, { cwd: dir });
  } else {
    await execP(`git push ${remote} --delete ${branch}`, { cwd: dir });
  }
}

/**
 * Checkout a branch locally or create tracking branch for remote.
 * Failsafe: init repo if no remote.
 * @param {string} dir - Repo directory.
 * @param {string} branch - Branch name to checkout.
 * @param {string} [remote] - Remote name (if tracking).
 */
export async function restoreBranch(dir, branch, remote) {
  if (!remote) {
    await ensureLocalRepo(dir);
    await execP(`git checkout ${branch}`, { cwd: dir });
  } else {
    await execP(`git checkout --track ${remote}/${branch}`, { cwd: dir });
  }
}

/**
 * Merge one branch into another (supports remote sources).
 * Failsafe: init repo for local merges.
 * @param {string} dir - Repo directory.
 * @param {string} sourceBranch - Source branch name.
 * @param {string} [sourceRemote] - Source remote (if merging remote).
 * @param {string} targetBranch - Target branch name.
 * @param {string} [targetRemote] - Target remote (if checking out remote).
 */
export async function mergeBranch(
  dir,
  sourceBranch,
  sourceRemote,
  targetBranch,
  targetRemote
) {
  if (!targetRemote) {
    await ensureLocalRepo(dir);
    await execP(`git checkout ${targetBranch}`, { cwd: dir });
  } else {
    await execP(`git checkout --track ${targetRemote}/${targetBranch}`, { cwd: dir });
  }

  let mergeTarget = sourceBranch;
  if (sourceRemote) {
    await execP(`git fetch ${sourceRemote}`, { cwd: dir });
    mergeTarget = `${sourceRemote}/${sourceBranch}`;
  }

  await execP(`git merge ${mergeTarget}`, { cwd: dir });
}

/**
 * Push a branch to its remote or specified remote.
 * @param {string} dir - Repo directory.
 * @param {string} branch - Branch name to push.
 * @param {string} [remote='origin'] - Remote name.
 */
export async function pushBranch(dir, branch, remote = 'origin') {
  await execP(`git push ${remote} ${branch}`, { cwd: dir });
}

/**
 * Pull updates for a branch from its remote or local.
 * Failsafe: init repo if pulling locally.
 * @param {string} dir - Repo directory.
 * @param {string} branch - Branch name to pull.
 * @param {string} [remote] - Remote name (if provided).
 */
export async function pullBranch(dir, branch, remote) {
  if (!remote) {
    await ensureLocalRepo(dir);
    await execP('git pull', { cwd: dir });
  } else {
    await execP(`git fetch ${remote}`, { cwd: dir });
    await execP(`git merge ${remote}/${branch}`, { cwd: dir });
  }
}

/**
 * Restore specific files from a given ref (commit SHA or branch).
 * Failsafe: init repo first.
 * @param {string} dir - Repo directory.
 * @param {string} ref - Commit SHA or branch name.
 * @param {string|string[]} files - File path(s) to restore.
 */
export async function restoreFilesFromRef(dir, ref, files) {
  await ensureLocalRepo(dir);
  const fileList = Array.isArray(files) ? files.join(' ') : files;
  await execP(`git checkout ${ref} -- ${fileList}`, { cwd: dir });
}

// --- HTTP Route Handlers ---

/** POST /api/git/versions
 * Body: { maxCount?: number }
 */
export async function listVersionsRoute(ctx) {
  const { maxCount } = ctx.request.body;
  try {
    const versions = await listVersions(SAVED_DIR, maxCount);
    return ctx.json(200, { versions });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/changelog
 * Body: { ref: string }
 */
export async function getChangelogRoute(ctx) {
  const { ref } = ctx.request.body;
  if (!ref) return ctx.json(400, { error: 'Missing ref' });
  try {
    const changelog = await getChangelog(SAVED_DIR, ref);
    return ctx.json(200, { changelog });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** GET /api/git/branches */
export async function listBranchesRoute(ctx) {
  try {
    const branches = await listBranches(SAVED_DIR);
    return ctx.json(200, { branches });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches
 * Body: { branch: string, remote?: string, startPoint?: string }
 */
export async function createBranchRoute(ctx) {
  const { branch, remote, startPoint } = ctx.request.body;
  if (!branch) return ctx.json(400, { error: 'Missing branch' });
  try {
    await createBranch(SAVED_DIR, branch, remote, startPoint);
    return ctx.json(201, {
      message: `Branch '${branch}' created${remote ? ` from ${remote}` : ''}`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches/delete
 * Body: { branch: string, remote?: string, force?: boolean }
 */
export async function deleteBranchRoute(ctx) {
  const { branch, remote, force } = ctx.request.body;
  if (!branch) return ctx.json(400, { error: 'Missing branch' });
  try {
    await deleteBranch(SAVED_DIR, branch, remote, force);
    return ctx.json(200, {
      message: `Branch '${branch}' deleted${remote ? ` from ${remote}` : ''}`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches/restore
 * Body: { branch: string, remote?: string }
 */
export async function restoreBranchRoute(ctx) {
  const { branch, remote } = ctx.request.body;
  if (!branch) return ctx.json(400, { error: 'Missing branch' });
  try {
    await restoreBranch(SAVED_DIR, branch, remote);
    return ctx.json(200, {
      message: `Checked out '${branch}'${remote ? ` from ${remote}` : ''}`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches/merge
 * Body: { sourceBranch: string, sourceRemote?: string, targetBranch: string, targetRemote?: string }
 */
export async function mergeBranchRoute(ctx) {
  const { sourceBranch, sourceRemote, targetBranch, targetRemote } = ctx.request.body;
  if (!sourceBranch || !targetBranch)
    return ctx.json(400, { error: 'Missing sourceBranch or targetBranch' });
  try {
    await mergeBranch(
      SAVED_DIR,
      sourceBranch,
      sourceRemote,
      targetBranch,
      targetRemote
    );
    return ctx.json(200, {
      message: `Merged '${sourceBranch}'${sourceRemote ? ` from ${sourceRemote}` : ''} into '${targetBranch}'`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches/push
 * Body: { branch: string, remote?: string }
 */
export async function pushBranchRoute(ctx) {
  const { branch, remote } = ctx.request.body;
  if (!branch) return ctx.json(400, { error: 'Missing branch' });
  try {
    await pushBranch(SAVED_DIR, branch, remote);
    return ctx.json(200, {
      message: `Pushed '${branch}' to '${remote || 'origin'}'`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/branches/pull
 * Body: { branch: string, remote?: string }
 */
export async function pullBranchRoute(ctx) {
  const { branch, remote } = ctx.request.body;
  if (!branch) return ctx.json(400, { error: 'Missing branch' });
  try {
    await pullBranch(SAVED_DIR, branch, remote);
    return ctx.json(200, {
      message: `Pulled '${branch}'${remote ? ` from ${remote}` : ''}`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/** POST /api/git/restore-files
 * Body: { ref: string, files: string|string[] }
 */
export async function restoreFilesRoute(ctx) {
  const { ref, files } = ctx.request.body;
  if (!ref || !files)
    return ctx.json(400, { error: 'Missing ref or files' });
  try {
    await restoreFilesFromRef(SAVED_DIR, ref, files);
    return ctx.json(200, {
      message: `Files restored from '${ref}'`
    });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/**
 * Route configuration mapping HTTP paths to handlers.
 */
export const routesConfig = {
  '/api/git/versions':          { POST: listVersionsRoute },
  '/api/git/changelog':         { POST: getChangelogRoute },
  '/api/git/branches':          { GET: listBranchesRoute,   POST: createBranchRoute },
  '/api/git/branches/delete':   { POST: deleteBranchRoute },
  '/api/git/branches/restore':  { POST: restoreBranchRoute },
  '/api/git/branches/merge':    { POST: mergeBranchRoute },
  '/api/git/branches/push':     { POST: pushBranchRoute },
  '/api/git/branches/pull':     { POST: pullBranchRoute },
  '/api/git/restore-files':     { POST: restoreFilesRoute }
};
