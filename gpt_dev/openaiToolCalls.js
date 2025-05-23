import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs'
import http from 'http';
import https from 'https';
import { Transform } from 'stream';
import { spawn, exec } from 'child_process'
import {
  makeFileWalker,
  sseChannel,
  pendingConsoleHistory
} from './serverUtil.js';


/* ────────── tool schemas ────────── */
export const baseFunctionSchemas = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 file; returns {content, byteLength, modifiedTime}',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        filename: { type: 'string' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing output if it is too large.' }
      },
      required: ['folder', 'filename', 'summary_prompt']
    }
  },
  {
    name: 'write_file',
    description: 'Overwrite / patch a UTF-8 file (insert_at or replace_range optional). Content must be the exact file text. Be sure to read a program file before modifying so you do not do something redundant or breaking.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' },
        insert_at: { type: 'integer' },
        replace_range: { type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } } },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing file diff if result is too large.' }
      },
      required: ['folder', 'filename', 'content', 'summary_prompt']
    }
  },
  {
    name: 'copy_file',
    description: 'Copy a file from source to destination (preserves the original)',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path to source file, relative to project root' },
        destination: { type: 'string', description: 'Path to destination file, relative to project root' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing copy result if output is large.' }
      },
      required: ['source', 'destination', 'summary_prompt']
    }
  },
  {
    name: 'list_directory',
    description: 'List directory contents. Always skip node_modules unless necessary to save tokens, you can just read the package.json.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        recursive: { type: 'boolean' },
        skip_node_modules: { type: 'boolean' },
        deep_node_modules: { type: 'boolean' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing directory listing when too long.' }
      },
      required: ['summary_prompt']
    }
  },
  {
    name: 'fetch_file',
    description: 'Download a file from the internet and save it locally',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL of the file to download' },
        destination: { type: 'string', description: 'Relative path to save file' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing fetched file metadata if needed.' }
      },
      required: ['url', 'destination', 'summary_prompt']
    }
  },
  {
    name: 'move_file',
    description: 'Move / rename a path (creates destination dirs if needed)',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        destination: { type: 'string' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing move operation if result is large.' }
      },
      required: ['source', 'destination', 'summary_prompt']
    }
  },
  {
    name: 'remove_directory',
    description: 'Delete a directory (recursive by default)',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        recursive: { type: 'boolean' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing deletion result if verbose.' }
      },
      required: ['folder', 'summary_prompt']
    }
  },
  {
    name: 'rename_file',
    description: 'Rename a file within a folder',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Relative folder path' },
        old_filename: { type: 'string', description: 'Current file name' },
        new_filename: { type: 'string', description: 'New file name' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing rename operation if needed.' }
      },
      required: ['folder', 'old_filename', 'new_filename', 'summary_prompt']
    }
  },
  {
    name: 'reset_project',
    description: 'Wipe all project files except dist, node_modules, and gpt_dev, then restore from ./gpt_dev/default',
    parameters: {
      type: 'object',
      properties: {
        summary_prompt: { type: 'string', description: 'System prompt for summarizing reset operation.' }
      },
      required: ['summary_prompt']
    }
  },
  {
    name: 'run_shell',
    description: 'Run a shell command in project root; returns { stdout, stderr, code }',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The exact shell command to execute (e.g. "npm install", "node build.js")' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing shell output if it is large.' }
      },
      required: ['command', 'summary_prompt']
    }
  },
  {
    name: 'reprompt_self',
    description: 'Immediately run one more assistant turn with the provided prompt. Only call at end of tool chain and if user asked autonomous work.',
    parameters: {
      type: 'object',
      properties: {
        new_prompt: { type: 'string' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing self-prompt outputs if needed.' }
      },
      required: ['new_prompt', 'summary_prompt']
    }
  },
  {
    name: 'smart_chat',
    description: 'USE THIS FOR BETTER CODE COMPLETIONS: Run a chat completion on the SMART_MODEL; returns the assistant’s reply. You should use this to get better code completion results e.g. by uploading tool call responses to it and asking it for specifically formatted code. VERY IMPORTANT since your model is more limited for better logical or stylistically sophisticated code. But this is just a chat completion it has no memory so give it proper context..',
    parameters: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          description: 'An array of { role: "system"|"user"|"assistant", content: string } messages',
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['system', 'user', 'assistant']
              },
              content: {
                type: 'string'
              }
            },
            required: ['role', 'content']
          }
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature (defaults to 0.7)'
        },
        max_completion_tokens: {
          type: 'integer',
          description: 'Maximum tokens to generate (defaults to model max)'
        },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing smart chat result.' }

      },
      required: ['messages', 'summary_prompt']
    }
  },
  {
    name: 'get_console_history',
    description: 'Ask the (assumed to be running) front-end for window.__consoleHistory__; returns an array of {level,timestamp,args}',
    parameters: {
      type: 'object',
      properties: {
        summary_prompt: { type: 'string', description: 'System prompt for summarizing console history if lengthy.' }
      },
      required: ['summary_prompt']
    }
  },
  {
    name: 'search_replace',
    description: 'Search for a string (or regex) and replace it in one file or across many files',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Root folder to search in' },
        filename: {
          type: 'string',
          description: 'If provided, only operate on this single file (relative to folder)'
        },
        search: {
          type: 'string',
          description: 'Literal string or RegExp to search for'
        },
        replace: {
          type: 'string',
          description: 'Replacement text'
        },
        bulk: {
          type: 'boolean',
          description: 'If true, apply replace across all files under folder; otherwise only filename'
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing results if output is large'
        }
      },
      required: ['folder', 'search', 'replace', 'summary_prompt']
    }
  },
  {
    name: 'run_python',
    description: 'Run a Python script in the project root with optional positional arguments; returns { stdout, stderr, code }',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Path to the Python file (relative to project root, e.g. "scripts/my_job.py")'
        },
        args: {
          type: 'array',
          description: 'Positional arguments to pass to the script',
          items: { type: 'string' },
          default: []
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing Python output if it is large.'
        }
      },
      required: ['script', 'summary_prompt']
    }
  },
  {
    /* ── 1. create_sidecar ───────────────────────────────────────────── */
    name: 'create_sidecar',
    description:
      'Launch a long-running subprocess (“sidecar”) that keeps running in the background; returns { id } where id is an auto-incrementing numeric handle.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Executable or shell command to run (e.g. "node", "python", "npm run dev").'
        },
        args: {
          type: 'array',
          description: 'Positional arguments to pass to the command.',
          items: { type: 'string' },
          default: []
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the subprocess (optional).'
        },
        env: {
          type: 'object',
          description: 'Environment variables as key/value pairs (optional).',
          additionalProperties: { type: 'string' }
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing the spawn result.'
        }
      },
      required: ['command', 'summary_prompt']
    }
  },
  
  {
    /* ── 2. get_sidecar_output ───────────────────────────────────────── */
    name: 'get_sidecar_output',
    description:
      'Retrieve the current captured stdout (and stderr) buffer for a running sidecar; returns { stdout, stderr, running }.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: 'Numeric sidecar id returned from create_sidecar.'
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing captured output.'
        }
      },
      required: ['id', 'summary_prompt']
    }
  },
  
  {
    /* ── 3. terminate_sidecar ────────────────────────────────────────── */
    name: 'terminate_sidecar',
    description:
      'Terminate a running sidecar process by id, **or** terminate *all* sidecars when no id is supplied; returns { terminatedIds }.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          description: 'Sidecar id to terminate (omit to kill every active sidecar).'
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing the termination outcome.'
        }
      },
      required: ['summary_prompt']
    }
  },

  {
    name: 'wait',
    description: 'Pause execution for a specified duration (milliseconds) before continuing.',
    parameters: {
      type: 'object',
      properties: {
        milliseconds: {
          type: 'integer',
          description: 'How long to wait, in ms (e.g. 2000 = 2 s).',
          minimum: 0
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing when the wait completes.'
        }
      },
      required: ['milliseconds', 'summary_prompt']
    }
  }
  
  
];

export const gitFunctionSchemas = [
  // GIT FUNCTIONALITY (only use when the user explicitly requests Git operations)
  // {
  //   name: 'commit_git_snapshot',
  //   description: 'Uses the Git CLI (`git add .` and `git commit -m ...`, and if a remote is configured, `git push`) to commit all current changes with a timestamped message. Only invoke this when the user explicitly asks to snapshot or push the repository.',
  //   parameters: {
  //     type: 'object',
  //     properties: {
  //       dir: { type: 'string', description: 'Path to the Git repository directory' },
  //       summary_prompt: { type: 'string', description: 'System prompt for summarizing commit result.' }
  //     },
  //     required: ['dir', 'summary_prompt']
  //   }
  // },

  // --- Git history and diff tools ---
  {
    name: 'list_versions',
    description: 'Uses the Git CLI (`git log --oneline`) to list commit history on the current branch. Only invoke when the user explicitly asks to view past commits.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        maxCount: { type: 'integer', description: 'Max commits to return (optional)' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing versions list.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'get_changelog',
    description: 'Uses the Git CLI (`git log -p <ref>`) to retrieve detailed changelog diffs for a commit SHA or range. Only invoke when the user explicitly asks to examine diffs.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        ref: { type: 'string', description: 'Commit SHA, branch name, or range' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing changelog.' }
      },
      required: ['dir', 'ref', 'summary_prompt']
    }
  },

  {
    name: 'remove_local_git_repo',
    description: 'Deletes the local Git repository by removing the `.git` folder. Only invoke when the user explicitly asks to reset the repo.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the directory containing the .git folder' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing removal result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'get_current_branch',
    description: 'Uses the Git CLI (`git rev-parse --abbrev-ref HEAD`) to return the name of the current branch. Only invoke when the user explicitly asks to view the active branch.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing branch name.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'list_remotes',
    description: 'Uses the Git CLI (`git remote -v`) to list all configured remotes and their URLs. Only invoke when the user explicitly asks to view remotes.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing remotes list.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'set_remote_url',
    description: 'Uses the Git CLI (`git remote add` or `git remote set-url`) to add or update a remote. Only invoke when the user explicitly asks to configure a remote.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        name: { type: 'string', description: 'Name of the remote to add or update (e.g., "origin")' },
        url: { type: 'string', description: 'URL of the remote repository' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing remote configuration result.' }
      },
      required: ['dir', 'name', 'url', 'summary_prompt']
    }
  },
  {
    name: 'fetch_all',
    description: 'Uses the Git CLI (`git fetch --all`) to fetch updates from all remotes. Only invoke when the user explicitly asks to fetch.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing fetch result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'hard_reset',
    description: 'Uses the Git CLI (`git reset --hard <commit>`) to reset the working tree to the specified commit (default HEAD). Only invoke when the user explicitly asks to reset.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        commit: { type: 'string', description: 'Commit SHA or ref to reset to (defaults to HEAD)' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing reset result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'stash_all',
    description: 'Uses the Git CLI (`git stash push` with optional `--include-untracked`) to stash all local changes. Only invoke when the user explicitly asks to stash.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        includeUntracked: { type: 'boolean', description: 'Whether to include untracked files in the stash' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing stash result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'apply_stash',
    description: 'Uses the Git CLI (`git stash apply`) to apply a stash entry. Only invoke when the user explicitly asks to apply a stash.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        stashRef: { type: 'string', description: 'Stash reference to apply (e.g., "stash@{0}")' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing apply-stash result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'drop_stash',
    description: 'Uses the Git CLI (`git stash drop`) to drop a stash entry. Only invoke when the user explicitly asks to drop a stash.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        stashRef: { type: 'string', description: 'Stash reference to drop (e.g., "stash@{0}")' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing drop-stash result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'clean_working_directory',
    description: 'Uses the Git CLI (`git clean -f -d`) to remove untracked files and directories. Only invoke when the user explicitly asks to clean.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        force: { type: 'boolean', description: 'Whether to force deletion of untracked files' },
        dirs: { type: 'boolean', description: 'Whether to remove untracked directories' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing clean result.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: "get_compare",
    description: "Uses the Git CLI (`git diff HEAD..<ref>`) to compare the current HEAD against a given branch or commit. Only invoke when the user explicitly asks to compare.",
    parameters: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Path to the Git repository directory"
        },
        ref: {
          type: "string",
          description: "Branch name or commit SHA to diff against HEAD"
        },
        summary_prompt: {
          type: "string",
          description: "System prompt for summarizing the compare result."
        }
      },
      required: ["dir", "ref", "summary_prompt"]
    }
  },
  {
    name: 'rollback_one',
    description: 'Uses the Git CLI (`git reset --hard HEAD~1`) to roll back the current branch by exactly one commit. Only invoke when the user explicitly asks to roll back the last commit.',
    parameters: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Path to the Git repository directory'
        },
        summary_prompt: {
          type: 'string',
          description: 'System prompt for summarizing the rollback result.'
        }
      },
      required: ['dir', 'summary_prompt']
    }
  }

];

export const tools = [
  ...baseFunctionSchemas,
  ...gitFunctionSchemas

].map(fn => ({ type: 'function', function: fn }));

/* ────────── sidecar process table ────────── */
const sidecars   = new Map();   // id → { proc, stdoutBuf, stderrBuf }
let   nextSideId = 1;           // simple auto-increment handle

export const baseToolHandlers = {

  async read_file({ folder, filename }, { safe }) {
    const fp = safe(folder, filename);
    try {
      const txt = await fs.readFile(fp, 'utf-8');
      const st = await fs.stat(fp);
      return {
        result: JSON.stringify({
          content: txt,
          byteLength: st.size,
          modifiedTime: st.mtime.toISOString()
        })
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { result: JSON.stringify({ content: '', byteLength: 0, modifiedTime: null }) };
      }
      throw err;
    }
  },

  async write_file({ folder, filename, content, replace_range, insert_at }, { safe }) {
    const dir = safe(folder);
    await fs.mkdir(dir, { recursive: true });
    const fp = safe(folder, filename);

    let existing = '';
    try { existing = await fs.readFile(fp, 'utf-8'); } catch { }

    let out = content;
    if (replace_range) {
      out = existing.slice(0, replace_range.start)
        + content
        + existing.slice(replace_range.end);
    } else if (Number.isInteger(insert_at)) {
      out = existing.slice(0, insert_at) + content + existing.slice(insert_at);
    }

    await fs.writeFile(fp, out, 'utf-8');
    const st2 = await fs.stat(fp);

    return {
      result: JSON.stringify({ byteLength: st2.size }),
      didWriteOp: true
    };
  },

  async search_replace(
    { folder, filename, search, replace, bulk = false },
    { safe }
  ) {
    const rootDir = safe(folder);
    const files = bulk
      ? (await makeFileWalker({ recursive: true, skip_node_modules: true })(rootDir))
        .filter(f => /\.(js|ts|json|txt)$/.test(f))   // adjust as needed
      : [path.join(rootDir, filename)];

    const results = [];
    for (const f of files) {
      let stat;
      try { stat = await fs.stat(f); }
      catch { continue; }

      // choose streaming for >10 MB
      if (stat.size > 10 * 1024 * 1024) {
        const tmp = f + '.tmp';
        await new Promise((res, rej) => {
          const rs = fsSync.createReadStream(f);
          const ws = fsSync.createWriteStream(tmp);
          rs
            .pipe(new ReplaceStream(search, replace))
            .pipe(ws)
            .on('finish', res)
            .on('error', rej);
        });
        await fs.rename(tmp, f);
        results.push(`(stream) replaced in ${path.relative(rootDir, f)}`);
      } else {
        // small-file fallback
        const src = await fs.readFile(f, 'utf-8');
        const updated = src.replace(new RegExp(search, 'g'), replace);
        if (updated !== src) {
          await fs.writeFile(f, updated, 'utf-8');
          results.push(`(buffer) replaced in ${path.relative(rootDir, f)}`);
        }
      }
    }

    return {
      result: JSON.stringify({ filesModified: results }),
      didWriteOp: results.length > 0
    };
  },

  async copy_file({ source, destination }, { safe, root }) {
    const src = safe(source);
    const dst = safe(destination);
    if (!src.startsWith(root) || !dst.startsWith(root)) {
      return { result: `Error: invalid path (outside project root)` };
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    try {
      await fs.copyFile(src, dst);
      return { result: `Copied ${source} → ${destination}`, didWriteOp: true };
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { result: `Error copying "${source}": file not found` };
      }
      throw err;
    }
  },

  async fetch_file({ url, destination }, { safe }) {
    const dst = safe(destination);
    await fs.mkdir(path.dirname(dst), { recursive: true });

    let succeeded = false;
    try {
      await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, res => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const stream = fsSync.createWriteStream(dst);
          res.pipe(stream);
          stream.once('finish', () => stream.close(resolve));
        });
        req.once('error', err => {
          fsSync.unlink(dst, () => { });
          reject(err);
        });
      });
      succeeded = true;
    } catch (err) {
      return { result: `Error fetching "${url}": ${err.message}` };
    }

    if (succeeded) {
      return { result: `Fetched ${url} → ${destination}`, didWriteOp: true };
    }
  },

  async list_directory({ folder = '.', recursive, skip_node_modules, deep_node_modules }, { safe }) {
    const absPath = safe(folder);
    let items = [];
    try {
      const walker = makeFileWalker({
        recursive,
        skip_node_modules: skip_node_modules !== false,
        deep_node_modules: deep_node_modules === true
      });
      items = await walker(absPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        items = [];
      } else {
        throw err;
      }
    }
    return { result: JSON.stringify(items) };
  },

  async move_file({ source, destination }, { safe }) {
    const src = safe(source);
    const dst = safe(destination);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.rename(src, dst);
    return { result: `Moved ${source} → ${destination}`, didWriteOp: true };
  },

  async remove_directory({ folder, recursive }, { safe }) {
    await fs.rm(safe(folder), { recursive: recursive !== false, force: true });
    return { result: `Removed directory ${folder}`, didWriteOp: true };
  },

  async rename_file({ folder, old_filename, new_filename }, { safe }) {
    const dir = safe(folder);
    await fs.rename(path.join(dir, old_filename), path.join(dir, new_filename));
    return { result: `Renamed ${old_filename} → ${new_filename}`, didWriteOp: true };
  },

  async reset_project(_, { root }) {
    const msg = await resetProject();
    return { result: msg, didWriteOp: true };
  },

  async run_shell({ command }, { root }) {
    if (command === 'npm run build') {
      return { result: 'Illegal command.' };
    }
    const { stdout, stderr, code } = await new Promise(resolve =>
      exec(command, { cwd: root, shell: true }, (err, so, se) =>
        resolve({ stdout: so.trim(), stderr: se.trim(), code: err?.code ?? 0 })
      )
    );
    return { result: JSON.stringify({ stdout, stderr, code }), didWriteOp: false };
  },

  async reprompt_self({ new_prompt }) {
    return { selfPrompt: new_prompt, result: 'Scheduled self-prompt' };
  },

  async get_console_history(_, { }) {
    const id = Math.random() * 1e15;
    // assume sseChannel and pendingConsoleHistory are in scope
    sseChannel.broadcast(JSON.stringify({ type: 'request_console_history', id }), 'console');
    const history = await new Promise((resolve, reject) => {
      pendingConsoleHistory.set(id, resolve);
      setTimeout(() => {
        pendingConsoleHistory.delete(id);
        reject(new Error('console history timeout'));
      }, 15000);
    });
    return { result: JSON.stringify(history) };
  },

  async run_python({ script, args = [] }, { root, safe }) {
    // Make sure the script path stays inside the project root
    const src = safe(script);
  
    const proc = spawn('python', [src, ...args], { cwd: root });
  
    let stdout = '';
    let stderr = '';

    /* stream → buffer + echo */
    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      entry.stdoutBuf += text;
      process.stdout.write(`[python] ${text}`);
    });
    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      entry.stderrBuf += text;
      process.stderr.write(`[python ERROR] ${text}`);
    });


    const code = await new Promise(resolve => {
      proc.on('close', c => resolve(c ?? 0));
    });
  
    return {
      result: JSON.stringify({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code
      }),
      didWriteOp: false
    };
  },

  async create_sidecar({ command, args = [], cwd, env = {} }, { root }) {
    // spawn the child; inherit ENV plus any overrides
    const proc = spawn(
      command,           // can be "npm" or a whole string like "npm run dev"
      args,
      {
        cwd:   cwd ? path.resolve(root, cwd) : root,
        env:   { ...process.env, ...env },
        shell: true,     
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    
   
    proc.on('error', err => {
      entry.stderrBuf += `[spawn error] ${err.message}\n`;
      entry.proc = null;          // mark as dead
    });
    
    const id = nextSideId++;
    const entry = { proc, stdoutBuf: '', stderrBuf: '' };
    sidecars.set(id, entry);
  
    
    /* stream → buffer + echo */
    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      entry.stdoutBuf += text;
      process.stdout.write(`[sidecar] ${text}`);
    });
    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      entry.stderrBuf += text;
      process.stderr.write(`[sidecar ERROR] ${text}`);
    });



    proc.on('exit', () => {
      // keep last output but mark as exited by deleting proc ref
      entry.exitedAt = Date.now();
      entry.proc = null;
    });
  
    return { result: JSON.stringify({ id }), didWriteOp: false };
  },

  async get_sidecar_output({ id }, _ctx) {
    if (!sidecars.has(id)) {
      return { result: JSON.stringify({ error: `No sidecar with id ${id}` }) };
    }
  
    const { proc, stdoutBuf, stderrBuf, exitedAt } = sidecars.get(id);
    return {
      result: JSON.stringify({
        stdout: stdoutBuf,
        stderr: stderrBuf,
        running: !!proc,
        exitedAt: exitedAt ?? null
      }),
      didWriteOp: false
    };
  },
  
  async terminate_sidecar({ id }, _ctx) {
    const idsToKill = id != null ? [id] : [...sidecars.keys()];
    const terminated = [];
  
    for (const sid of idsToKill) {
      const entry = sidecars.get(sid);
      if (!entry) continue;
  
      if (entry.proc) {
        try { entry.proc.kill('SIGTERM'); } catch {}
        entry.proc = null;
      }
      terminated.push(sid);
      // we leave the buffers for post-mortem inspection, but you may sidecars.delete(sid) if preferred
    }
  
    return {
      result: JSON.stringify({ terminatedIds: terminated }),
      didWriteOp: false
    };
  },
 
  async wait({ milliseconds }, _ctx) {
    await new Promise(res => setTimeout(res, milliseconds));
    return {
      result: `Waited ${milliseconds} ms`,
      didWriteOp: false
    };
  },
  
  
}


class ReplaceStream extends Transform {
  constructor(search, replace) {
    super();
    // allow passing a string or a RegExp
    this.rx = typeof search === 'string' ? new RegExp(search, 'g') : search;
    this.replace = replace;
    this.tail = '';
  }
  _transform(chunk, _enc, cb) {
    const data = this.tail + chunk.toString();
    const parts = data.split(this.rx);
    this.tail = parts.pop();                      // save last partial match
    this.push(parts.join(this.replace));
    cb();
  }
  _flush(cb) {
    // flush any remaining tail
    this.push(this.tail.replace(this.rx, this.replace));
    cb();
  }
}
