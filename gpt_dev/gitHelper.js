//./gpt_dev/gitHelper.js

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { GIT_DIR } from './clientConfig.js'

console.log("CWD:", process.cwd());

const execP = promisify(exec);


/**
 * Ensure there’s a Git repo in `dir` (and make the first commit if needed).
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
 * Read the AI‐snapshot branch from Git config, or return null if unset.
 */
async function getAISnapshotBranch(dir) {
    try {
        const { stdout } = await execP(
            'git config --local ai.snapshotBranch',
            { cwd: dir }
        );
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Write the AI‐snapshot branch into Git config.
 */
async function setAISnapshotBranch(dir, branch) {
    await execP(
        `git config --local ai.snapshotBranch ${branch}`,
        { cwd: dir }
    );
}

/**
 * Make sure we’re on an “ai-branchN”:
 *  • if ai.snapshotBranch is set, just check it out
 *  • otherwise pick the next ai-branchN (based on existing names),
 *    create & checkout it, and record it in config.
 */

/**
 * Return true iff a local branch actually exists.
 * (The try/catch swallows the non-zero exit when it doesn’t.)
 */
async function branchExists(dir, name) {
    try {
      await execP(`git rev-parse --verify --quiet refs/heads/${name}`, { cwd: dir });
      return true;           // command exited 0 → branch present
    } catch {
      return false;          // exited 1 (or anything non-zero) → branch absent
    }
  }
  
  /**
   * Make sure we’re on an `ai-branchN`.
   *   • If ai.snapshotBranch is recorded **and still present**, switch to it.
   *   • Otherwise create the next free `ai-branchN`, record it, and switch.
   * All working changes are preserved via stash-push / stash-pop.
   */
  async function ensureAISnapshotBranch(dir) {
    // 1️⃣ Save everything (incl. untracked) so nothing gets lost.
    await execP(
      'git stash push --include-untracked -m "AI auto-stash before branch switch"',
      { cwd: dir }
    );
  
    // 2️⃣ Decide which branch we should end up on.
    let branch = await getAISnapshotBranch(dir);
  
    if (branch && !(await branchExists(dir, branch))) {
      // Recorded branch vanished – fall back to “make a new one”.
      branch = null;
    }
  
    if (!branch) {
      // Enumerate existing ai-branch* names to pick the next free number.
      const { stdout } = await execP('git branch --list "ai-branch*"', { cwd: dir });
      const nums = stdout
        .split('\n')
        .map(l => l.replace('*', '').trim())
        .filter(Boolean)
        .map(b => Number(b.replace('ai-branch', '')))
        .filter(n => !Number.isNaN(n));
  
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
      branch = `ai-branch${nextNum}`;
  
      await execP(`git checkout -b ${branch}`, { cwd: dir });
      await setAISnapshotBranch(dir, branch);
    } else {
      await execP(`git checkout ${branch}`, { cwd: dir });
    }
  
    // 3️⃣ Restore the stash and immediately drop it so it won’t pile up.
    try {
      await execP('git stash pop --index', { cwd: dir });
    } catch {
      /* nothing to pop */ }
  
    return branch;
  }
  

/**
 * Stage & commit (and push) only on your AI branch.
 *
 * @param {string} dir      – path to the repo
 * @param {string[]} paths  – optional list of files/folders to stage
 */
export async function commitGitSnapshot(dir = process.cwd(), paths = []) {
    try {
        // 1) boot up repo if needed
        await ensureLocalRepo(dir);

        // 2) switch to your AI branch
        const branch = await ensureAISnapshotBranch(dir);

        // 3) see if there’s anything to do
        const { stdout: status } = await execP(
            'git status --porcelain',
            { cwd: dir }
        );
        if (!status.trim()) {
            console.log('⚡ No changes – skipping AI commit.');
            return;
        }

        // 4) stage only what you asked (or everything)
        const toAdd = paths.length ? paths.join(' ') : '.';
        await execP(`git add ${toAdd}`, { cwd: dir });

        // 5) commit with timestamp
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await execP(
            `git commit -m "🤖 AI run @ ${ts}"`,
            { cwd: dir }
        );
        console.log(`⚡ Committed to ${branch}`);

        // 6) push if there’s an origin
        //   const { stdout: remotes } = await execP('git remote', { cwd: dir });
        //   if (remotes.trim()) {
        //     await execP(`git push -u origin ${branch}`, { cwd: dir });
        //     console.log(`⚡ Pushed snapshot to origin/${branch}`);
        //   }
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

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
export async function getChangelog(dir, ref) {
    try {
        const { stdout } = await execP(
            `git log -1 -p ${ref}`,
            { cwd: dir, maxBuffer: DEFAULT_MAX_BUFFER }
        );
        return stdout;
    } catch (err) {
        console.error('getChangelog failed:', err);
        throw new Error(`Could not get diff for “${ref}”: ${err.stderr || err.message}`);
    }
}


/**
 * Compare current HEAD to a given ref (branch, tag, or SHA).
 * @param {string} dir – path to the Git repo
 * @param {string} ref – branch name, tag, or commit SHA to diff against HEAD
 * @returns {Promise<string>} the diff between HEAD and ref
 */
export async function getCompare(dir, ref) {
    try {
        const { stdout } = await execP(
            `git diff HEAD..${ref}`,
            { cwd: dir, maxBuffer: DEFAULT_MAX_BUFFER }
        );
        return stdout;
    } catch (err) {
        console.error('getCompare failed:', err);
        throw new Error(
            `Could not diff HEAD against "${ref}": ${err.stderr || err.message}`
        );
    }
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
 * Checkout or create a branch.
 * @param {string} dir     Git repo root
 * @param {string} branch  Branch name
 * @param {string} remote? Remote name, e.g. 'origin'
 */
export async function restoreBranch(dir, branch, remote) {
    await ensureLocalRepo(dir);

    // 1) nuke any stale lock
    const lockPath = path.join(dir, '.git', 'index.lock');
    await fs.promises.rm(lockPath, { force: true });

    // 2) stash everything (ignore failure)
    try {
        await execP('git stash push --include-untracked -m "auto-stash before checkout"', { cwd: dir });
    } catch { }

    // 3) checkout (with fallback to force)
    try {
        if (remote) {
            await execP(`git fetch ${remote}`, { cwd: dir });
            await execP(`git checkout --track ${remote}/${branch}`, { cwd: dir });
        } else {
            await execP(`git rev-parse --verify ${branch}`, { cwd: dir }); // branch exists?
            await execP(`git checkout ${branch}`, { cwd: dir });
        }
    } catch (err) {
        // if normal checkout fails, try a forced one
        console.warn(`normal checkout failed: ${err.message}, attempting forced checkout`);
        await execP(`git checkout -f ${branch}`, { cwd: dir });
    }

    // 4) reapply stash (ignore errors)
    try {
        await execP('git stash apply', { cwd: dir });
    } catch { }

    // success! no exception → HTTP 200
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


/**
 * Get the name of the current branch.
 * @param {string} dir
 * @returns {Promise<string>} branch name
 */
export async function getCurrentBranch(dir) {
    const { stdout } = await execP(
        'git rev-parse --abbrev-ref HEAD',
        { cwd: dir }
    );
    return stdout.trim();
}

/**
 * List all configured remotes and their URLs.
 * @param {string} dir
 * @returns {Promise<Object[]>} Array of { name, url }
 */
export async function listRemotes(dir) {
    const { stdout } = await execP('git remote -v', { cwd: dir });
    return stdout
        .trim()
        .split('\n')
        .map(line => {
            const [name, url, type] = line.split(/\s+/);
            return { name, url, type: type.replace(/[()]/g, '') };
        });
}

/**
 * Add or update a remote.
 * @param {string} dir
 * @param {string} name  - remote name (e.g. 'origin')
 * @param {string} url   - repository URL
 */
export async function setRemoteUrl(dir, name, url) {
    // if it exists, set-url; otherwise add
    const remotes = (await listRemotes(dir)).map(r => r.name);
    if (remotes.includes(name)) {
        await execP(`git remote set-url ${name} ${url}`, { cwd: dir });
    } else {
        await execP(`git remote add ${name} ${url}`, { cwd: dir });
    }
}

/**
 * Fetch all updates (all remotes & branches).
 * @param {string} dir
 */
export async function fetchAll(dir) {
    await execP('git fetch --all', { cwd: dir });
}

/**
 * Hard‐reset the working tree to a given commit (destroys local changes).
 * @param {string} dir
 * @param {string} [commit='HEAD']  - commit SHA or ref
 */
export async function hardReset(dir, commit = 'HEAD') {
    await execP(`git reset --hard ${commit}`, { cwd: dir });
}

/**
 * Stash all local changes (including untracked if desired).
 * @param {string} dir
 * @param {boolean} includeUntracked  - pass `--include-untracked` if true
 * @returns {Promise<string>} stash ref created
 */
export async function stashAll(dir, includeUntracked = false) {
    const flag = includeUntracked ? '--include-untracked' : '';
    const { stdout } = await execP(
        `git stash push ${flag} -m "🤖 AI snapshot"`,
        { cwd: dir }
    );
    // stdout includes the stash ref, e.g. "Saved working directory... as stash@{0}"
    return stdout.trim();
}

/**
 * Apply a stash (default is the most recent).
 * @param {string} dir
 * @param {string} [stashRef='stash@{0}']
 */
export async function applyStash(dir, stashRef = 'stash@{0}') {
    await execP(`git stash apply ${stashRef}`, { cwd: dir });
}

/**
 * Drop a stash entry (default is the most recent).
 * @param {string} dir
 * @param {string} [stashRef='stash@{0}']
 */
export async function dropStash(dir, stashRef = 'stash@{0}') {
    await execP(`git stash drop ${stashRef}`, { cwd: dir });
}

/**
 * Clean untracked files and directories.
 * @param {string} dir
 * @param {boolean} [force=true]  - use -f
 * @param {boolean} [dirs=true]   - clean directories with -d
 */
export async function cleanWorkingDirectory(dir, force = true, dirs = true) {
    const flags = [
        force ? '-f' : '',
        dirs ? '-d' : ''
    ].filter(Boolean).join(' ');
    await execP(`git clean ${flags}`, { cwd: dir });
}

/**
 * Stage one or more paths.
 * @param {string} dir   – repo directory
 * @param {string[]} files – list of file paths to stage
 */
export async function stageFiles(dir, files) {
    // ensure repo exists & cwd is correct
    await ensureLocalRepo(dir);
    // git add each file
    const fileList = Array.isArray(files) ? files.join(' ') : files;
    await execP(`git add ${fileList}`, { cwd: dir });
}

/**
 * Unstage one or more paths (reset them from the index).
 * @param {string} dir   – repo directory
 * @param {string[]} files – list of file paths to unstage
 */
export async function unstageFiles(dir, files) {
    await ensureLocalRepo(dir);
    const fileList = Array.isArray(files) ? files.join(' ') : files;
    // reset only those files in the index back to HEAD
    await execP(`git reset HEAD -- ${fileList}`, { cwd: dir });
}



/**
 * Factory that turns a “service” into a Koa-style handler.
 *
 * @param {Function} serviceFn  - async fn(args) → { ...responseBody }
 * @param {Object}   opts
 * @param {string[]} opts.required  - which keys must exist on body/query
 * @param {string}   [opts.method='POST']  - 'GET' or 'POST'
 * @param {number}   [opts.successCode=200]
 */
function makeRoute(serviceFn, { required = [], method = 'POST', successCode = 200 } = {}) {
    const isGet = method.toUpperCase() === 'GET';

    return async function route(ctx) {
        // fall back in case ctx.request is missing
        const query = ctx.request?.query ?? ctx.query ?? {};
        const body = ctx.request?.body ?? ctx.body ?? {};

        const data = isGet ? query : body;

        // validate required keys
        for (const key of required) {
            if (data[key] == null) {
                return ctx.json(400, { error: `Missing ${key}` });
            }
        }

        try {
            const payload = await serviceFn(data);
            return ctx.json(successCode, payload);
        } catch (err) {
            console.error('git service failure:', err.stderr || err.message);
            return ctx.json(500, { error: err.stderr?.trim() || err.message });
        }
    };
}


// helper to parse `git status --porcelain`
export async function getStatus(dir) {
    // ensure repo is initialized
    await ensureLocalRepo(dir);

    const { stdout } = await execP('git status --porcelain', { cwd: dir });
    const lines = stdout.split('\n').filter(Boolean);

    const staged = [];
    const unstaged = [];

    for (const line of lines) {
        // first char = staged change, second = unstaged change
        const [stagedFlag, unstagedFlag] = [line[0], line[1]];
        const file = line.slice(3);

        if (stagedFlag !== ' ') staged.push(file);
        if (unstagedFlag !== ' ') unstaged.push(file);
    }

    return { staged, unstaged };
}


/**
 * Roll back the current branch by one commit (hard reset to HEAD~1).
 * @param {string} dir – path to the Git repo
 */
export async function rollbackOne(dir) {
    // ensure we have a repo
    await ensureLocalRepo(dir);
    // hard reset HEAD back one
    await execP('git reset --hard HEAD~1', { cwd: dir });
}

// ─── Service adapters ─────────────────────────────────────────────────────────
const gitServices = {
    listVersions: ({ maxCount }) => listVersions(GIT_DIR, maxCount).then(versions => ({ versions })),
    getChangelog: ({ ref }) => getChangelog(GIT_DIR, ref).then(changelog => ({ changelog })),
    listBranches: () => listBranches(GIT_DIR).then(branches => ({ branches })),
    createBranch: ({ branch, remote, startPoint }) =>
        createBranch(GIT_DIR, branch, remote, startPoint)
            .then(() => ({ message: `Branch '${branch}' created${remote ? ` from ${remote}` : ''}` })),
    deleteBranch: ({ branch, remote, force }) =>
        deleteBranch(GIT_DIR, branch, remote, force)
            .then(() => ({ message: `Branch '${branch}' deleted${remote ? ` from ${remote}` : ''}` })),
    restoreBranch: ({ branch, remote }) =>
        restoreBranch(GIT_DIR, branch, remote)
            .then(() => ({ message: `Checked out '${branch}'${remote ? ` from ${remote}` : ''}` })),
    mergeBranch: ({ sourceBranch, sourceRemote, targetBranch, targetRemote }) =>
        mergeBranch(GIT_DIR, sourceBranch, sourceRemote, targetBranch, targetRemote)
            .then(() => ({
                message: `Merged '${sourceBranch}'${sourceRemote ? ` from ${sourceRemote}` : ''} into '${targetBranch}'`
            })),
    pushBranch: ({ branch, remote }) =>
        pushBranch(GIT_DIR, branch, remote)
            .then(() => ({ message: `Pushed '${branch}' to '${remote || 'origin'}'` })),
    pullBranch: ({ branch, remote }) =>
        pullBranch(GIT_DIR, branch, remote)
            .then(() => ({ message: `Pulled '${branch}'${remote ? ` from ${remote}` : ''}` })),
    restoreFiles: ({ ref, files }) =>
        restoreFilesFromRef(GIT_DIR, ref, files)
            .then(() => ({ message: `Files restored from '${ref}'` })),
    commitPaths: ({ paths }) => {
        if (!Array.isArray(paths) || !paths.length) {
            throw new Error('Missing paths array');
        }
        return commitGitSnapshot(GIT_DIR, paths)
            .then(() => ({ message: `Committed: ${paths.join(', ')}` }));
    },
    removeLocal: () => removeLocalGitRepo(GIT_DIR).then(() => ({ message: 'Local Git repo removed.' })),
    currentBranch: () => getCurrentBranch(GIT_DIR).then(branch => ({ branch })),
    listRemotes: () => listRemotes(GIT_DIR).then(remotes => ({ remotes })),
    setRemote: ({ name, url }) => setRemoteUrl(GIT_DIR, name, url)
        .then(() => ({ message: `Remote '${name}' set to '${url}'.` })),
    fetchAll: () => fetchAll(GIT_DIR).then(() => ({ message: 'Fetched all remotes.' })),
    hardReset: ({ commit }) => hardReset(GIT_DIR, commit)
        .then(() => ({ message: `Hard reset to '${commit || 'HEAD'}'.` })),
    stashAll: ({ includeUntracked }) =>
        stashAll(GIT_DIR, includeUntracked)
            .then(stashRef => ({ message: `Stashed as ${stashRef}.` })),
    applyStash: ({ stashRef }) => applyStash(GIT_DIR, stashRef)
        .then(() => ({ message: `Applied stash '${stashRef || 'stash@{0}'}'.` })),
    dropStash: ({ stashRef }) => dropStash(GIT_DIR, stashRef)
        .then(() => ({ message: `Dropped stash '${stashRef || 'stash@{0}'}'.` })),
    cleanWorkdir: ({ force, dirs }) =>
        cleanWorkingDirectory(GIT_DIR, force, dirs)
            .then(() => ({ message: 'Cleaned working directory.' })),
    rollbackOne: () => rollbackOne(GIT_DIR).then(() => ({ message: 'Rolled back one commit' })),
    status: () => getStatus(GIT_DIR).then(({ staged, unstaged }) => ({ staged, unstaged })),
    stage: ({ files }) => stageFiles(GIT_DIR, files).then(() => ({ message: `Staged ${files.join(', ')}` })),
    unstage: ({ files }) => unstageFiles(GIT_DIR, files).then(() => ({ message: `Unstaged ${files.join(', ')}` })),
    getCompare: ({ ref }) => getCompare(GIT_DIR, ref).then(changelog => ({ changelog }))
};

// ─── Generate handlers ─────────────────────────────────────────────────────────
export const listVersionsRoute = makeRoute(gitServices.listVersions, { required: [], method: 'POST' });
export const getChangelogRoute = makeRoute(gitServices.getChangelog, { required: ['ref'], method: 'POST' });
export const listBranchesRoute = makeRoute(gitServices.listBranches, { required: [], method: 'GET' });
export const createBranchRoute = makeRoute(gitServices.createBranch, { required: ['branch'], method: 'POST', successCode: 201 });
export const deleteBranchRoute = makeRoute(gitServices.deleteBranch, { required: ['branch'], method: 'POST' });
export const restoreBranchRoute = makeRoute(gitServices.restoreBranch, { required: ['branch'], method: 'POST' });
export const mergeBranchRoute = makeRoute(gitServices.mergeBranch, { required: ['sourceBranch', 'targetBranch'], method: 'POST' });
export const pushBranchRoute = makeRoute(gitServices.pushBranch, { required: ['branch'], method: 'POST' });
export const pullBranchRoute = makeRoute(gitServices.pullBranch, { required: ['branch'], method: 'POST' });
export const restoreFilesRoute = makeRoute(gitServices.restoreFiles, { required: ['ref', 'files'], method: 'POST' });
export const removeLocalGitRepoRoute = makeRoute(gitServices.removeLocal, { required: [], method: 'POST' });
export const getCurrentBranchRoute = makeRoute(gitServices.currentBranch, { required: [], method: 'GET' });
export const listRemotesRoute = makeRoute(gitServices.listRemotes, { required: [], method: 'GET' });
export const setRemoteUrlRoute = makeRoute(gitServices.setRemote, { required: ['name', 'url'], method: 'POST' });
export const fetchAllRoute = makeRoute(gitServices.fetchAll, { required: [], method: 'POST' });
export const hardResetRoute = makeRoute(gitServices.hardReset, { required: [], method: 'POST' });
export const stashRoute = makeRoute(gitServices.stashAll, { required: [], method: 'POST' });
export const applyStashRoute = makeRoute(gitServices.applyStash, { required: [], method: 'POST' });
export const dropStashRoute = makeRoute(gitServices.dropStash, { required: [], method: 'POST' });
export const cleanWorkingDirectoryRoute = makeRoute(gitServices.cleanWorkdir, { required: [], method: 'POST' });
export const statusRoute = makeRoute(gitServices.status, {
    required: [],      // no params needed
    method: 'GET',
    successCode: 200
});
export const commitPathsRoute = makeRoute(
    gitServices.commitPaths,
    { required: ['paths'], method: 'POST', successCode: 200 }
);
export const getCompareRoute = makeRoute(
    gitServices.getCompare,
    { required: ['ref'], method: 'POST' }
);
export const stageRoute = makeRoute(gitServices.stage, { required: ['files'], method: 'POST' });
export const unstageRoute = makeRoute(gitServices.unstage, { required: ['files'], method: 'POST' });
export const rollbackOneRoute = makeRoute(gitServices.rollbackOne, { required: [], method: 'POST' });

/**
 * Route configuration mapping HTTP paths to handlers.
 */
export const routesConfig = {
    '/api/git/versions': { POST: listVersionsRoute },
    '/api/git/changelog': { POST: getChangelogRoute },
    '/api/git/branches': { GET: listBranchesRoute, POST: createBranchRoute },
    '/api/git/branches/delete': { POST: deleteBranchRoute },
    '/api/git/branches/restore': { POST: restoreBranchRoute },
    '/api/git/branches/merge': { POST: mergeBranchRoute },
    '/api/git/branches/push': { POST: pushBranchRoute },
    '/api/git/branches/pull': { POST: pullBranchRoute },
    '/api/git/restore-files': { POST: restoreFilesRoute },
    '/api/git/remove-local-repo': { POST: removeLocalGitRepoRoute },
    '/api/git/current-branch': { GET: getCurrentBranchRoute },
    '/api/git/remotes': { GET: listRemotesRoute, POST: setRemoteUrlRoute },
    '/api/git/fetch-all': { POST: fetchAllRoute },
    '/api/git/hard-reset': { POST: hardResetRoute },
    '/api/git/stash': { POST: stashRoute },
    '/api/git/apply-stash': { POST: applyStashRoute },
    '/api/git/drop-stash': { POST: dropStashRoute },
    '/api/git/clean': { POST: cleanWorkingDirectoryRoute },
    '/api/git/commit-paths': { POST: commitPathsRoute },
    '/api/git/status': { GET: statusRoute },
    '/api/git/compare': { POST: getCompareRoute },
    '/api/git/stage': { POST: stageRoute },
    '/api/git/rollback-one': { POST: rollbackOneRoute },
    '/api/git/unstage': { POST: unstageRoute }
};


export const gitToolCalls = {

    async commit_git_snapshot({ dir }) {
        await commitGitSnapshot(dir);
        return { result: JSON.stringify({ message: `Committed snapshot in ${dir}` }), didWriteOp: true };
    },

    async list_versions({ dir, maxCount }) {
        const versions = await listVersions(dir, maxCount);
        return { result: JSON.stringify({ versions }) };
    },

    async get_changelog({ dir, ref }) {
        if (!ref) throw new Error('Missing ref');
        const changelog = await getChangelog(dir, ref);
        return { result: JSON.stringify({ changelog }) };
    },

    async list_branches({ dir }) {
        const branches = await listBranches(dir);
        return { result: JSON.stringify({ branches }) };
    },

    async create_branch({ dir, branch, remote, startPoint }) {
        await createBranch(dir, branch, remote, startPoint);
        return {
            result: JSON.stringify({ message: `Branch '${branch}' created${remote ? ` from ${remote}` : ''}` }),
            didWriteOp: true
        };
    },

    async delete_branch({ dir, branch, remote, force }) {
        await deleteBranch(dir, branch, remote, force);
        return {
            result: JSON.stringify({ message: `Branch '${branch}' deleted${remote ? ` from ${remote}` : ''}` }),
            didWriteOp: true
        };
    },

    async restore_branch({ dir, branch, remote }) {
        await restoreBranch(dir, branch, remote);
        return {
            result: JSON.stringify({ message: `Checked out '${branch}'${remote ? ` from ${remote}` : ''}` }),
            didWriteOp: true
        };
    },

    async merge_branch({ dir, sourceBranch, sourceRemote, targetBranch, targetRemote }) {
        await mergeBranch(dir, sourceBranch, sourceRemote, targetBranch, targetRemote);
        return {
            result: JSON.stringify({
                message: `Merged '${sourceBranch}'${sourceRemote ? ` from ${sourceRemote}` : ''} into '${targetBranch}'`
            }),
            didWriteOp: true
        };
    },

    async push_branch({ dir, branch, remote }) {
        await pushBranch(dir, branch, remote);
        return { result: JSON.stringify({ message: `Pushed '${branch}' to '${remote || 'origin'}'` }) };
    },

    async pull_branch({ dir, branch, remote }) {
        await pullBranch(dir, branch, remote);
        return { result: JSON.stringify({ message: `Pulled '${branch}'${remote ? ` from ${remote}` : ''}` }) };
    },

    async restore_files_from_ref({ dir, ref, files }) {
        if (!ref || !files) throw new Error('Missing ref or files');
        await restoreFilesFromRef(dir, ref, files);
        return { result: JSON.stringify({ message: `Restored files from '${ref}'` }), didWriteOp: true };
    },

    async remove_local_git_repo({ dir }) {
        await removeLocalGitRepo(dir);
        return { result: JSON.stringify({ message: 'Local Git repo removed.' }), didWriteOp: true };
    },

    async get_current_branch({ dir }) {
        const branch = await getCurrentBranch(dir);
        return { result: JSON.stringify({ branch }) };
    },

    async list_remotes({ dir }) {
        const remotes = await listRemotes(dir);
        return { result: JSON.stringify({ remotes }) };
    },

    async set_remote_url({ dir, name, url }) {
        await setRemoteUrl(dir, name, url);
        return { result: JSON.stringify({ message: `Remote '${name}' set to '${url}'.` }) };
    },

    async fetch_all({ dir }) {
        await fetchAll(dir);
        return { result: JSON.stringify({ message: 'Fetched all remotes.' }) };
    },

    async hard_reset({ dir, commit }) {
        await hardReset(dir, commit);
        return { result: JSON.stringify({ message: `Hard reset to '${commit || 'HEAD'}'.` }) };
    },

    async stash_all({ dir, includeUntracked }) {
        const stashRef = await stashAll(dir, includeUntracked);
        return { result: JSON.stringify({ message: `Stashed as ${stashRef}.` }) };
    },

    async apply_stash({ dir, stashRef }) {
        await applyStash(dir, stashRef);
        return { result: JSON.stringify({ message: `Applied stash '${stashRef || 'stash@{0}'}'.` }) };
    },

    async drop_stash({ dir, stashRef }) {
        await dropStash(dir, stashRef);
        return { result: JSON.stringify({ message: `Dropped stash '${stashRef || 'stash@{0}'}'.` }) };
    },

    async clean_working_directory({ dir, force, dirs }) {
        await cleanWorkingDirectory(dir, force, dirs);
        return { result: JSON.stringify({ message: 'Cleaned working directory.' }) };
    },

    /**
   * Roll back current branch one commit.
   * @param {string} dir – path to the Git repo
   */
    async rollback_one({ dir }) {
        await rollbackOne(dir);
        return {
            result: JSON.stringify({ message: `Rolled back one commit in ${dir}` }),
            didWriteOp: true
        };
    },

    /**
     * Compare HEAD to a given ref.
     * @param dir – repo path
     * @param ref – branch name or commit SHA
     */
    async get_compare({ dir, ref }) {
        if (!ref) throw new Error('Missing ref');
        const changelog = await getCompare(dir, ref);
        return {
            result: JSON.stringify({ changelog }),
            didWriteOp: false
        };
    },
}