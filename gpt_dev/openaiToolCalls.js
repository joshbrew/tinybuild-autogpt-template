/* ────────── tool schemas ────────── */
export const functionSchemas = [
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
    description: 'Ask the front-end for window.__consoleHistory__; returns an array of {level,timestamp,args}',
    parameters: {
      type: 'object',
      properties: {
        summary_prompt: { type: 'string', description: 'System prompt for summarizing console history if lengthy.' }
      },
      required: ['summary_prompt']
    }
  },

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

  // --- Git branch management tools ---
  {
    name: 'list_branches',
    description: 'Uses the Git CLI (`git branch -a`) to list all local and remote branches. Only invoke when the user explicitly asks to see branch names.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repository directory' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing branches list.' }
      },
      required: ['dir', 'summary_prompt']
    }
  },
  {
    name: 'create_branch',
    description: 'Uses the Git CLI (`git checkout -b` or `git checkout -b <branch> <remote>/<branch>`) to create a new local branch or track a remote branch. Only invoke when the user explicitly asks to create or switch branches.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        branch: { type: 'string', description: 'Name of the branch to create' },
        remote: { type: 'string', description: 'Optional remote to track (e.g., "origin")' },
        startPoint: { type: 'string', description: 'Base commit or branch (defaults to HEAD)' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing branch creation.' }
      },
      required: ['dir', 'branch', 'summary_prompt']
    }
  },
  {
    name: 'delete_branch',
    description: 'Uses the Git CLI (`git branch -d` or `-D`, or `git push <remote> --delete`) to delete a branch locally or on a remote. Only invoke when the user explicitly asks to remove a branch.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        branch: { type: 'string', description: 'Name of the branch to delete' },
        remote: { type: 'string', description: 'Optional remote name (to delete remotely)' },
        force: { type: 'boolean', description: 'Force delete local branch (true for -D)' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing deletion.' }
      },
      required: ['dir', 'branch', 'summary_prompt']
    }
  },
  {
    name: 'restore_branch',
    description: 'Uses the Git CLI (`git checkout <branch>` or `git checkout --track <remote>/<branch>`) to checkout or track a branch. Only invoke when the user explicitly asks to switch branches.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        branch: { type: 'string', description: 'Name of the branch to checkout' },
        remote: { type: 'string', description: 'Optional remote to track' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing checkout.' }
      },
      required: ['dir', 'branch', 'summary_prompt']
    }
  },
  {
    name: 'merge_branch',
    description: 'Uses the Git CLI (`git merge <source>` after optionally fetching) to merge one branch into another. Only invoke when the user explicitly asks to merge branches.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        sourceBranch: { type: 'string', description: 'Name of source branch' },
        sourceRemote: { type: 'string', description: 'Optional remote for source' },
        targetBranch: { type: 'string', description: 'Name of target branch' },
        targetRemote: { type: 'string', description: 'Optional remote for target' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing merge result.' }
      },
      required: ['dir', 'sourceBranch', 'targetBranch', 'summary_prompt']
    }
  },

  // --- Git push/pull tools ---
  {
    name: 'push_branch',
    description: 'Uses the Git CLI (`git push`) to push a branch to its remote (default origin). Only invoke when the user explicitly asks to push changes.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        branch: { type: 'string', description: 'Name of the branch to push' },
        remote: { type: 'string', description: 'Remote name (defaults to origin)' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing push result.' }
      },
      required: ['dir', 'branch', 'summary_prompt']
    }
  },
  {
    name: 'pull_branch',
    description: 'Uses the Git CLI (`git fetch` and `git merge` or `git pull`) to pull updates for a branch from its remote. Only invoke when the user explicitly asks to pull changes.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        branch: { type: 'string', description: 'Name of the branch to pull' },
        remote: { type: 'string', description: 'Optional remote name' },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing pull result.' }
      },
      required: ['dir', 'branch', 'summary_prompt']
    }
  },

  // --- Git file restore tool ---
  {
    name: 'restore_files_from_ref',
    description: 'Uses the Git CLI (`git checkout <ref> -- <files>`) to restore specific files from a given ref. Only invoke when the user explicitly asks to revert or restore files.',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Path to the Git repo' },
        ref: { type: 'string', description: 'Commit SHA or branch name' },
        files: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } }
          ],
          description: 'Path or list of file paths to restore'
        },
        summary_prompt: { type: 'string', description: 'System prompt for summarizing restore operation.' }
      },
      required: ['dir', 'ref', 'files', 'summary_prompt']
    }
  }

];

export const tools = functionSchemas.map(fn => ({ type: 'function', function: fn }));