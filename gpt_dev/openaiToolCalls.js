/* ────────── tool schemas ────────── */
export const functionSchemas = [
    {
      name: 'read_file',
      description: 'Read a UTF-8 file; returns {content, byteLength, modifiedTime}',
      parameters: {
        type: 'object',
        properties: {
          folder:         { type: 'string' },
          filename:       { type: 'string' },
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
          folder:         { type: 'string' },
          filename:       { type: 'string' },
          content:        { type: 'string' },
          insert_at:      { type: 'integer' },
          replace_range:  { type: 'object', properties: { start:{type:'integer'}, end:{type:'integer'} } },
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
          source:         { type: 'string', description: 'Path to source file, relative to project root' },
          destination:    { type: 'string', description: 'Path to destination file, relative to project root' },
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
          folder:            { type:'string' },
          recursive:         { type:'boolean' },
          skip_node_modules: { type:'boolean' },
          deep_node_modules: { type:'boolean' },
          summary_prompt:    { type:'string', description: 'System prompt for summarizing directory listing when too long.' }
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
          url:             { type: 'string', description: 'HTTP(S) URL of the file to download' },
          destination:     { type: 'string', description: 'Relative path to save file' },
          summary_prompt:  { type: 'string', description: 'System prompt for summarizing fetched file metadata if needed.' }
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
          source:          { type:'string' },
          destination:     { type:'string' },
          summary_prompt:  { type: 'string', description: 'System prompt for summarizing move operation if result is large.' }
        },
        required: ['source','destination','summary_prompt']
      }
    },
    {
      name: 'remove_directory',
      description: 'Delete a directory (recursive by default)',
      parameters: {
        type: 'object',
        properties: {
          folder:          { type:'string' },
          recursive:       { type:'boolean' },
          summary_prompt:  { type: 'string', description: 'System prompt for summarizing deletion result if verbose.' }
        },
        required: ['folder','summary_prompt']
      }
    },
    {
      name: 'rename_file',
      description: 'Rename a file within a folder',
      parameters: {
        type: 'object',
        properties: {
          folder:          { type: 'string', description: 'Relative folder path' },
          old_filename:    { type: 'string', description: 'Current file name' },
          new_filename:    { type: 'string', description: 'New file name' },
          summary_prompt:  { type: 'string', description: 'System prompt for summarizing rename operation if needed.' }
        },
        required: ['folder','old_filename','new_filename','summary_prompt']
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
          command:        { type: 'string', description: 'The exact shell command to execute (e.g. "npm install", "node build.js")' },
          summary_prompt: { type: 'string', description: 'System prompt for summarizing shell output if it is large.' }
        },
        required: ['command','summary_prompt']
      }
    },
    {
      name: 'reprompt_self',
      description: 'Immediately run one more assistant turn with the provided prompt. Only call at end of tool chain and if user asked autonomous work.',
      parameters: {
        type: 'object',
        properties: {
          new_prompt:     { type: 'string' },
          summary_prompt: { type: 'string', description: 'System prompt for summarizing self-prompt outputs if needed.' }
        },
        required: ['new_prompt','summary_prompt']
      }
    },
    {
        name: 'smart_chat',
        description: 'Run a chat completion on the SMART_MODEL; returns the assistant’s reply',
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
            max_tokens: {
              type: 'integer',
              description: 'Maximum tokens to generate (defaults to model max)'
            },
            summary_prompt: { type: 'string', description: 'System prompt for summarizing smart chat result.' }
        
          },
          required: ['messages','summary_prompt']
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
    }
  ];
    
  export const tools = functionSchemas.map(fn => ({ type:'function', function:fn }));