// ./gpt_dev/openaiUtils.js

import path from 'path';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';
import OpenAI from 'openai';
import { exec } from 'child_process';
import {sseChannel, pendingConsoleHistory, logError, logInfo, logSuccess, logWarn} from './serverUtil.js'
import dotenv from 'dotenv';
dotenv.config();

//depends on model and account permissions. default for 4.1 is 30k tokens, 4.1-mini is 200k
const TOKEN_LIMIT_PER_MIN = 30000; //200000
export const MODEL = process.env.GPT_MODEL || 'gpt-4.1'; //gpt-4.1-mini //<-- 200K context for mini

// ─── Runtime config ─────────────────────────────────────────────────
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
export const SAVED_DIR = process.env.SAVED_DIR ||
  path.join(process.cwd(), 'gpt_dev/saved');
export const ASSISTANT_FILE = path.join(SAVED_DIR, 'assistant.json');

// ─── System prompt & tool schemas ────────────────────────────────────
//todo: refine.
export const DEFAULT_SYSTEM_PROMPT = `
You are a server assistant for a hot-reloading web dev environment.

Use the provided functions to inspect/modify project files, run shell commands, and fetch console history. Always respect your context-window limits and re-read files between edits to avoid conflicts (e.g. between index.html and index.js).

If the user asks you to “go ahead and work on this yourself,” terminate your tool chain with **reprompt_self** supplying the next prompt; only do this when explicitly instructed.

Do not edit files in gpt_dev unless instructed. Do *NOT* edit gpt_dev/default, just edit the project root files.

The project root contains:
- **.env**, **.gitignore**, **favicon.ico**
- **index.css**, **index.html**, **index.js**
- **package-lock.json**, **package.json**, **README.md**
- **tinybuild.config.js**

**tinybuild.config.js** uses esbuild to bundle index.js (or index.ts/.jsx/.tsx), CSS imports, and supports custom routes. If you rename index.js, update its entry point in tinybuild.config.js. Worker files auto-bundle when you "import './worker.js'".

The default **index.html** references "dist/index.css" and "dist/index.js". Stick to single-page apps or modify tinybuild.config.js to contain more routes in the server config for easy multi-page site demoing, import assets in index.js, and refer to https://github.com/joshbrew/tinybuild for full details.
`;

/* ────────── tool schemas ────────── */
export const functionSchemas = [
    {
      name: 'read_file',
      description: 'Read a UTF‑8 file; returns {content, byteLength, modifiedTime}',
      parameters: {
        type: 'object',
        properties: {
          folder:   { type: 'string' },
          filename: { type: 'string' }
        },
        required: ['folder','filename']
      }
    },
    {
      name: 'write_file',
      description: 'Overwrite / patch a UTF‑8 file (insert_at or replace_range optional). Content must be the exact file text. Be sure to read a program file before modifying so you do not do something redundant or breaking.',
      parameters: {
        type: 'object',
        properties: {
          folder:        { type: 'string' },
          filename:      { type: 'string' },
          content:       { type: 'string' },
          insert_at:     { type: 'integer' },
          replace_range: {
            type: 'object',
            properties: { start:{type:'integer'}, end:{type:'integer'} }
          }
        },
        required:['folder','filename','content']
      }
    },
    {
      name: 'copy_file',
      description: 'Copy a file from source to destination (preserves the original)',
      parameters: {
        type: 'object',
        properties: {
          source:      { type: 'string', description: 'Path to source file, relative to project root' },
          destination: { type: 'string', description: 'Path to destination file, relative to project root' }
        },
        required:['source','destination']
      }
    },
    {
      name: 'list_directory',
      description: 'List directory contents. Skip node_modules unless skip_node_modules=false.',
      parameters: {
        type: 'object',
        properties: {
          folder:            { type:'string' },
          recursive:         { type:'boolean' },
          skip_node_modules: { type:'boolean' },
          deep_node_modules: { type:'boolean' }
        },
        required:[]
      }
    },
    {
      name: 'fetch_file',
      description: 'Download a file from the internet and save it locally',
      parameters: {
        type: 'object',
        properties: {
          url:         { type: 'string', description: 'HTTP(S) URL of the file to download' },
          destination: { type: 'string', description: 'Relative path to save file' }
        },
        required:['url','destination']
      }
    },
    {
      name: 'move_file',
      description: 'Move / rename a path (creates destination dirs if needed)',
      parameters: {
        type: 'object',
        properties:{ source:{type:'string'}, destination:{type:'string'} },
        required:['source','destination']
      }
    },
    {
      name: 'remove_directory',
      description: 'Delete a directory (recursive by default)',
      parameters: {
        type: 'object',
        properties:{ folder:{type:'string'}, recursive:{type:'boolean'} },
        required:['folder']
      }
    },
    {
      name: 'rename_file',
      description: 'Rename a file within a folder',
      parameters: {
        type: 'object',
        properties: {
          folder:       { type: 'string', description: 'Relative folder path' },
          old_filename: { type: 'string', description: 'Current file name' },
          new_filename: { type: 'string', description: 'New file name' }
        },
        required: ['folder','old_filename','new_filename']
      }
    },
    {
      name: 'reset_project',
      description: 'Wipe all project files except dist, node_modules, and gpt_dev, then restore from ./gpt_dev/default',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'run_shell',
      description: 'Run a shell command in project root; returns { stdout, stderr, code }',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The exact shell command to execute (e.g. "npm install", "node build.js")'
          }
        },
        required: ['command']
      }
    },
    {
      name: 'reprompt_self',
      description:
        'Immediately run one more assistant turn with the provided prompt. '+
        'Only call at end of tool chain and if user asked autonomous work.',
      parameters:{
        type: 'object',
        properties:{ new_prompt:{ type:'string' } },
        required:['new_prompt']
      }
    },
    {
      name: 'get_console_history',
      description: 'Ask the front-end for window.__consoleHistory__; returns an array of {level,timestamp,args}',
      parameters: {
        type: 'object',
        properties: { },
        required: []
      }
    }
];
  
export const tools = functionSchemas.map(fn => ({ type:'function', function:fn }));



// ─── Tool‐calling runner ───────────────────────────────────────────────
export async function runToolCalls(toolCalls) {
  const fnLogs = [], follow = [];
  let selfPrompt = null;
  const root = process.cwd();
  const safe = (...p) => path.join(root, ...p);

  checkCancel(threadId);

  for (const tc of toolCalls) {
    const name = tc.function?.name ?? tc.name;
    const args = JSON.parse(tc.function?.arguments ?? tc.arguments);
    let result = '';

    switch (name) {

      case 'read_file': {
        const fp = safe(args.folder, args.filename);
        let txt, st;
        try {
          txt = await fs.readFile(fp, 'utf-8');
          st  = await fs.stat(fp);
        } catch (err) {
          if (err.code === 'ENOENT') {
            // fallback to empty content (or signal error back to ChatGPT)
            result = JSON.stringify({
              content:    '',
              byteLength: 0,
              modifiedTime: null
            });
            break;
          }
          throw err;
        }
        result = JSON.stringify({
          content: txt,
          byteLength: st.size,
          modifiedTime: st.mtime.toISOString()
        });
        break;
      }
      
      case 'write_file': {
        const dir = safe(args.folder);
        await fs.mkdir(dir, { recursive:true });
        const fp = safe(args.folder, args.filename);
        let existing = '';
        try { existing = await fs.readFile(fp, 'utf-8'); } catch {}
        let out = args.content;
        if (args.replace_range) {
          out = existing.slice(0, args.replace_range.start)
              + args.content
              + existing.slice(args.replace_range.end);
        } else if (Number.isInteger(args.insert_at)) {
          const p = args.insert_at;
          out = existing.slice(0, p) + args.content + existing.slice(p);
        }
        await fs.writeFile(fp, out, 'utf-8');
        const st2 = await fs.stat(fp);
        result = JSON.stringify({ byteLength: st2.size });
        break;
      }

      case 'copy_file': {
        const src = safe(args.source);
        const dst = safe(args.destination);
        const root = process.cwd();
      
        // 1) Ensure neither path escapes the project root
        if (!src.startsWith(root + path.sep) || !dst.startsWith(root + path.sep)) {
          result = `Error: invalid path (outside project root)`;
          break;
        }
      
        try {
          // 2) Ensure the destination directory exists
          await fs.mkdir(path.dirname(dst), { recursive: true });
          // 3) Attempt the copy
          await fs.copyFile(src, dst);
          result = `Copied ${args.source} → ${args.destination}`;
        } catch (err) {
          // 4) Missing source file? handle gracefully
          if (err.code === 'ENOENT') {
            result = `Error copying "${args.source}": file not found`;
            break;
          }
          // 5) Otherwise re-throw
          throw err;
        }
        break;
      }

      case 'fetch_file': {
        const url = args.url;
        const dst = safe(args.destination);
        await fs.mkdir(path.dirname(dst), { recursive:true });
        await new Promise((resolve, reject) => {
          const client = url.startsWith('https') ? https : http;
          const req = client.get(url, res => {
            if (res.statusCode !== 200) {
              return reject(new Error(`Failed to GET ${url}: ${res.statusCode}`));
            }
            const fileStream = fsSync.createWriteStream(dst);
            res.pipe(fileStream);
            fileStream.on('finish', () => fileStream.close(resolve));
          });
          req.on('error', err => {
            fsSync.unlink(dst, ()=>{});
            reject(err);
          });
        });
        result = `Fetched ${url} → ${args.destination}`;
        break;
      }

      case 'list_directory': {
        const folder = args.folder || '.';
        const absPath = safe(folder);
      
        // guard against “no such directory”
        let items = [];
        try {
          const walker = makeFileWalker({
            recursive:         args.recursive,
            skip_node_modules: args.skip_node_modules !== false,
            deep_node_modules: args.deep_node_modules === true,
          });
          items = await walker(absPath);
        } catch (err) {
          if (err.code === 'ENOENT') {
            console.warn(`list_directory: directory not found at ${absPath}, returning []`);
            items = [];
          } else {
            throw err;
          }
        }
      
        result = JSON.stringify(items);
        break;
      }

      case 'move_file': {
        const src = safe(args.source);
        const dst = safe(args.destination);
        await fs.mkdir(path.dirname(dst), { recursive:true });
        await fs.rename(src, dst);
        result = `Moved ${args.source} → ${args.destination}`;
        break;
      }

      case 'remove_directory': {
        await fs.rm(safe(args.folder), {
          recursive: args.recursive !== false,
          force: true
        });
        result = `Removed directory ${args.folder}`;
        break;
      }

      case 'rename_file': {
        const dir = safe(args.folder);
        await fs.rename(
          path.join(dir, args.old_filename),
          path.join(dir, args.new_filename)
        );
        result = `Renamed ${args.old_filename} → ${args.new_filename}`;
        break;
      }

      case 'reset_project': {
        const msg = await resetProject();
        result = msg;
        break;
      }

      case 'run_shell': {
        console.log("Shell running: ", args.command);
        if(args.command === 'npm run build') {
          result = "Illegal command."
          break; 
        }
        result = await new Promise(resolve => {
          exec(args.command, { cwd: root, shell: true }, (err, stdout, stderr) => {
            resolve(JSON.stringify({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              code: err ? err.code : 0
            }));
          });
        });
        break;
      }

      case 'reprompt_self': {
        selfPrompt = args.new_prompt;
        console.log("Prompting self: ", selfPrompt);
        result = 'Scheduled self-prompt';
        break;
      }

      case 'get_console_history': {
        // 1) create a request id and broadcast SSE
        const id = Math.random()*1000000000000000;
        sseChannel.broadcast(JSON.stringify({ type:'request_console_history', id }), 'console');
      
        // 2) wait for POST /api/console_history to resolve
        const history = await new Promise((resolve, reject) => {
          // keep resolver so the HTTP endpoint can call it
          pendingConsoleHistory.set(id, resolve);
          // 15-s timeout to avoid hanging forever
          setTimeout(() => {
            pendingConsoleHistory.delete(id);
            reject(new Error('console history timeout'));
          }, 15_000);
        });
      
        result = JSON.stringify(history);
        break;
      }

    }

    fnLogs.push({ type:'function_call', name, arguments:args });
    fnLogs.push({ type:'function_result', name, result });
    follow.push(
      { role:'assistant', tool_calls:[tc] },
      { role:'tool', tool_call_id:tc.id, name, content:result }
    );
  }

  fnLogs.forEach((l) => {
    if(l?.type === 'function_call') { 
      console.log("Assistant called", l.name);
    }
  });

  return { fnLogs, follow, selfPrompt };
}

// ─── Rate Limiting ───────────────────────────────────────────────────
const RATE_LIMIT_INTERVAL_MS = 500; // Minimum interval between OpenAI API calls (500ms = 120 RPM)
let lastApiCallTime = 0;
async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastApiCallTime;
  if (elapsed < RATE_LIMIT_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_INTERVAL_MS - elapsed));
  }
  lastApiCallTime = Date.now();
}



// ─── Reset project utility ───────────────────────────────────────────
export async function resetProject() {
  const root = process.cwd();
  const defaultDir = path.join(root, 'gpt_dev', 'default');

  // 1) Remove everything at root except dist, node_modules, and gpt_dev
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (['dist', 'node_modules', 'gpt_dev', '.env'].includes(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }
  }

  // 2) Recursively copy defaults back into project root
  async function copyRecursive(srcDir, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    const items = await fs.readdir(srcDir, { withFileTypes: true });
    for (const item of items) {
      const srcPath = path.join(srcDir, item.name);
      const destPath = path.join(destDir, item.name);
      if (item.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
  await copyRecursive(defaultDir, root);

  return 'Project reset from ./gpt_dev/default';
}

//for reading directories
export const makeFileWalker = opts => async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes:true })) {
    if (e.name === 'dist') continue;
    if (e.name === 'node_modules') {
      if (opts.skip_node_modules) continue;
      if (!opts.deep_node_modules) {
        const pkgs = await fs.readdir(path.join(dir,'node_modules'));
        out.push({ name:'node_modules', children: pkgs.map(n=>({name:n})) });
        continue;
      }
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const node = { name:e.name };
      if (opts.recursive) node.children = await walk(full);
      out.push(node);
    } else {
      out.push({ name:e.name });
    }
  }
  return out;
};

// ─── Token-bucket state ───────────────────────────────
const tokenHistory = [];  // { ts: <ms-since-epoch>, tokens: <number> }

function cleanTokenHistory() {
  const cutoff = Date.now() - 60_000;
  while (tokenHistory.length && tokenHistory[0].ts < cutoff) {
    tokenHistory.shift();
  }
}

function estimateTokensFromString(str) {
  return Math.ceil(str.length / 4);
}

async function throttleByTokens(estimate = 0) {
  const used = tokenHistory.reduce((sum,e) => sum + e.tokens, 0);
  if (used + estimate > TOKEN_LIMIT_PER_MIN) {
    // how many tokens we must free
    let excess = used + estimate - TOKEN_LIMIT_PER_MIN;
    let freed = 0, releaseTs = Date.now();
    for (const entry of tokenHistory) {
      freed += entry.tokens;
      if (freed >= excess) {
        releaseTs = entry.ts + 60_000;
        break;
      }
    }
    const waitMs = releaseTs - Date.now();
    console.log(`Throttling by tokens: waiting ${waitMs}ms to stay under ${TOKEN_LIMIT_PER_MIN}/min`);
    await new Promise(r => setTimeout(r, waitMs));

    cleanTokenHistory();

    // Reserve these tokens immediately so no other call can grab them
    if (estimate > 0) {
      tokenHistory.push({ ts: Date.now(), tokens: estimate });
    }

  }
}

// ─── Thread & run helpers ────────────────────────────────────────────
async function createRunWithRateLimitRetry(threadId, assistantId, instructions, tools) {
  while (true) {
    try {
      await rateLimit();  // your existing minimum‐interval throttle
      return await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId,
        instructions,
        tools,
        tool_choice: 'auto'
      });
    } catch (err) {
      // only retry on rate_limit_exceeded
      if (err.status === 429 && err.error?.code === 'rate_limit_exceeded') {
        // parse "Please try again in 14.818s"
        const m = err.error.message.match(/(\d+(\.\d+)?)s/);
        const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) : 16000;
        console.warn(`Run rate-limited; retrying in ${waitMs} ms…`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}


// ─── Wait for a run to finish, then record its token usage ──────────
export async function waitForRunCompletion(threadId, runId) {
  await rateLimit();
  let run = await openai.beta.threads.runs.retrieve(threadId, runId);

  // keep polling until it’s done, but allow cancellation at each step
  while (['queued', 'in_progress'].includes(run.status)) {
    checkCancel(threadId);
    await new Promise(r => setTimeout(r, 500));
    await rateLimit();
    run = await openai.beta.threads.runs.retrieve(threadId, runId);
  }

  // final cancellation check before we record or return
  checkCancel(threadId);

  if (run.usage?.total_tokens) {
    tokenHistory.push({ ts: Date.now(), tokens: run.usage.total_tokens });
    cleanTokenHistory();
  }

  return run;
}

// Handler to clear queued/in-progress runs for a thread:
export async function cancelRun(ctx) {
  const { thread_id } = ctx.params;
  let convo;

  try {
    convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  // mark cancellation
  requestCancel(convo.openaiThreadId);

  try {
    return ctx.json(200, { canceled: true });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

// ─── Init conversation ────────────────────────────────────────────────
export async function initConversation(threadId, title, savedDir) {
  logInfo(`initConversation (threadId=${threadId})`);
  let localId, convo;
  if (threadId) {
    localId = threadId;
    logInfo(`Loading existing convo file`);
    convo = await loadConversation(path.join(savedDir, `${localId}.txt`));
  } else {
    logInfo(`Creating new thread via API`);
    await rateLimit();
    logInfo(`API CALL: create thread`);
    const thread = await openai.beta.threads.create();
    localId = thread.id;
    convo = { messages: [], openaiThreadId: thread.id, title: title || '' };
    logSuccess(`Thread created ${thread.id}`);
  }
  if (!convo.title) {
      convo.title = title || localId || 'Chat';
      logInfo(`Conversation title set to "${convo.title}"`);
  }
  return { localId, convo };
}

// ─── Post a user message ─────────────────────────────────────────────
export async function postUserMessage(openaiThreadId, prompt) {
  logInfo(`API CALL: postUserMessage to thread ${openaiThreadId}`);
  const msg = await safeCreateMessage(openaiThreadId, {
    role: 'user',
    content: [{ type:'text', text: prompt.trim() }]
  });
  return msg;
}

/**
 * Splits an array of {tool_call_id, output} entries into
 * batches whose JSON-stringified size (in tokens) stays under
 * TOKEN_LIMIT_PER_MIN, submitting them one batch at a time.
 */
export async function submitToolOutputsInBatches(threadId, runId, toolOutputs) {
  // Turn to minimal payload entries
  const entries = toolOutputs.map(({ tool_call_id, output }) => ({ tool_call_id, output }));
  let idx = 0;

  while (idx < entries.length) {
    checkCancel(threadId);

    // 1) Refresh history & compute how many tokens remain in this minute
    cleanTokenHistory();
    const used = tokenHistory.reduce((sum, e) => sum + e.tokens, 0);
    const remaining = TOKEN_LIMIT_PER_MIN - used;

    if (remaining <= 0) {
      // no capacity right now — wait until the oldest usage is >60s old
      const waitUntil = tokenHistory[0].ts + 60_000;
      const waitMs = Math.max(0, waitUntil - Date.now());
      logInfo(`No TPM capacity; sleeping ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    // 2) Build the largest batch that fits under 'remaining'
    const batch = [];
    let batchEst = 0;
    while (idx < entries.length) {
      const cand = entries[idx];
      const trial = JSON.stringify([...batch, cand]);
      const trialEst = estimateTokensFromString(trial);

      if (trialEst > remaining) {
        if (batch.length === 0) {
          // Single entry too big — truncate it and retry
          cand.output = trimOutput(cand.output);
          continue;
        }
        break;
      }

      batch.push(cand);
      batchEst = trialEst;
      idx++;
    }

    // 3) Reserve tokens & submit this chunk
    await throttleByTokens(batchEst);
    checkCancel(threadId);
    logInfo(`Submitting batch of ${batch.length} tool_outputs (~${batchEst} tokens)`);
    await openai.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: batch
    });
  }
}

/**
 * Waits for any queued, in-progress, or requires_action runs to complete before proceeding.
 */
export async function waitForActiveRuns(threadId) {
  let cursor = null;
  do {
    checkCancel(threadId);
    const res = await openai.beta.threads.runs.list(threadId, { limit: 50, ...(cursor ? { cursor } : {}) });
    for (const r of res.data) {
      checkCancel(threadId);
      if (['queued', 'in_progress', 'requires_action'].includes(r.status)) {
        if (r.status === 'requires_action') {
          const { fnLogs: newLogs, follow, selfPrompt } =
            await runToolCalls(r.required_action.submit_tool_outputs.tool_calls);

          await rateLimit();

          const payload = { tool_outputs: follow.filter(m => m.role === 'tool')
            .map(t => ({ tool_call_id: t.tool_call_id, output: t.content })) };

          await submitToolOutputsInBatches(threadId, r.id, payload.tool_outputs);
        }
        await waitForRunCompletion(threadId, r.id);
      }
    }
    cursor = res.next_cursor;
  } while (cursor);
}

// ─── Safe POST of a user message with dynamic TPM check & cancel ────
export async function safeCreateMessage(threadId, params) {
  while (true) {
    // abort if user asked
    checkCancel(threadId);

    // build the flat text payload to estimate tokens
    let text = '';
    if (Array.isArray(params.content)) {
      text = params.content
        .map(c => (typeof c.text === 'string' ? c.text : c.text.value))
        .join('');
    } else {
      text = typeof params.content === 'string'
        ? params.content
        : JSON.stringify(params.content);
    }
    const estimate = estimateTokensFromString(text);

    // wait for enough “remaining” capacity
    cleanTokenHistory();
    const used     = tokenHistory.reduce((sum,e) => sum + e.tokens, 0);
    const remaining = TOKEN_LIMIT_PER_MIN - used;
    if (estimate > remaining) {
      // sleep until the oldest token drops out
      const waitUntil = tokenHistory[0].ts + 60_000;
      await new Promise(r => setTimeout(r, Math.max(0, waitUntil - Date.now())));
    }

    // reserve and send
    await throttleByTokens(estimate);
    try {
      return await openai.beta.threads.messages.create(threadId, params);
    } catch (err) {
      if (err.status === 400 && err.error?.message.includes('active run')) {
        // wait for any in-flight runs to finish, then retry
        await waitForActiveRuns(threadId);
        continue;
      }
      throw err;
    }
  }
}


// ─── Simple thread lock ──────────────────────────────────────────────
const threadLocks = new Map();
export async function lockThread(threadId) {
  while (threadLocks.get(threadId)) {
    await new Promise(r => setTimeout(r, 100));
  }
  threadLocks.set(threadId, true);
}
export function unlockThread(threadId) {
  threadLocks.delete(threadId);
}

// ─── Persistence ─────────────────────────────────────────────────────
export async function loadConversation(fp) {
  logInfo(`Loading conversation from ${fp}`);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    logSuccess(`File read successfully`);
    const data = JSON.parse(raw);
    logSuccess(`JSON parsed, ${Array.isArray(data) ? data.length : data.messages.length} messages`);
    if (Array.isArray(data)) {
      return { messages: data, openaiThreadId: null, title: '' };
    }
    return {
      messages:       data.messages || [],
      openaiThreadId: data.openaiThreadId || null,
      title:          data.title || data.openaiThreadId
    };
  } catch (err) {
    logWarn(`Could not load conversation (${err.message}), starting fresh`);
    return { messages: [], openaiThreadId: null, title: '' };
  }
}

export async function saveConversation(fp, convo) {
  logInfo(`Saving conversation to ${fp}`);
  await fs.mkdir(path.dirname(fp), { recursive:true });
  await fs.writeFile(fp,
    JSON.stringify({
      openaiThreadId: convo.openaiThreadId,
      title:          convo.title || convo.openaiThreadId,
      messages:       convo.messages
    }, null,2),
    'utf-8'
  );
  logSuccess(`Conversation saved (${convo.messages.length} messages)`);
}

// ─── Ensure or create assistant ──────────────────────────────────────
export async function ensureAssistant() {
  logInfo(`Ensuring assistant exists`);
  let existing;
  try {
    logInfo(`Reading assistant file ${ASSISTANT_FILE}`);
    const raw = await fs.readFile(ASSISTANT_FILE, 'utf-8');
    existing = JSON.parse(raw);
    logSuccess(`Found existing assistant ID ${existing.assistantId}`);
  } catch {
    logWarn(`No existing assistant file`);
    existing = null;
  }

  const currentInstr = DEFAULT_SYSTEM_PROMPT.trim();
  if (existing?.assistantId && existing.instructions === currentInstr) {
    logSuccess(`Using cached assistant ${existing.assistantId}`);
    return existing.assistantId;
  }

  if (existing?.assistantId) {
    logWarn(`Instructions changed; deleting old assistant ${existing.assistantId}`);
    try {
      await rateLimit();
      logInfo(`API CALL: delete assistant ${existing.assistantId}`);
      await openai.beta.assistants.del(existing.assistantId);
      logSuccess(`Deleted assistant ${existing.assistantId}`);
    } catch (err) {
      logError(`Failed to delete old assistant: ${err.message}`);
    }
  }

  logInfo(`Creating new assistant`);
  await rateLimit();
  logInfo(`API CALL: create assistant`);
  const asst = await openai.beta.assistants.create({
    name: 'Server Assistant',
    instructions: currentInstr,
    tools: [], // function‐calling only
    model: MODEL
  });
  const assistantId = asst.id;
  logSuccess(`Created assistant ${assistantId}`);

  await fs.mkdir(path.dirname(ASSISTANT_FILE), { recursive:true });
  await fs.writeFile(ASSISTANT_FILE,
    JSON.stringify({ assistantId, instructions:currentInstr }, null,2),
    'utf-8'
  );
  logSuccess(`Assistant file updated`);
  return assistantId;
}

// Track user‐requested cancels
const cancelFlags = new Map();

/** Mark this thread as “please cancel” */
export function requestCancel(threadId) {
  cancelFlags.set(threadId, true);
}

/** Throw if someone asked to cancel this thread */
function checkCancel(threadId) {
  if (cancelFlags.get(threadId)) {
    cancelFlags.delete(threadId);
    throw new Error('Cancelled by user');
  }
}

// ─── Core prompt flow ─────────────────────────────────────────────────
export async function handlePrompt({ prompt, threadId, title, systemPrompt }, savedDir) {
  if (!prompt?.trim()) {
    return { error: true, errorMessage: 'Missing prompt', logs: [] };
  }

  let allLogs = [];
  let convo, localId, assistantId;

  // 1) Setup assistant & conversation
  assistantId = await ensureAssistant();
  ({ localId, convo } = await initConversation(threadId, title, savedDir));

  // 2) Lock & clear prior runs
  await lockThread(convo.openaiThreadId);
  try {
    checkCancel(convo.openaiThreadId);
    if (convo.openaiThreadId) {
      await waitForActiveRuns(convo.openaiThreadId);
      checkCancel(convo.openaiThreadId);
    }

    // 3) Try up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // a) clear stray runs before posting
        if (convo.openaiThreadId) {
          await waitForActiveRuns(convo.openaiThreadId);
          checkCancel(convo.openaiThreadId);
        }

        // b) throttle for user prompt
        let userMsg;
        if (attempt === 1) {
          userMsg = await safeCreateMessage(convo.openaiThreadId, {
            role: 'user',
            content: [{ type: 'text', text: prompt.trim() }]
          });
        }
        checkCancel(convo.openaiThreadId);
        if (userMsg) convo.messages.push(userMsg);

        // c) run assistant + tools
        const { fnLogs, selfPrompt } = await runAssistantLoop(
          convo.openaiThreadId,
          assistantId,
          systemPrompt || DEFAULT_SYSTEM_PROMPT
        );
        checkCancel(convo.openaiThreadId);
        allLogs.push(...fnLogs);

        // d) fetch the reply
        const asst = await fetchAssistantReply(
          convo.openaiThreadId,
          fnLogs,
          runAssistantLoop.lastStatus
        );
        checkCancel(convo.openaiThreadId);

        if (runAssistantLoop.lastStatus !== 'completed') {
          throw new Error(`Run failed: ${runAssistantLoop.lastStatus}`);
        }

        // e) record & optionally handle self-prompt loops
        convo.messages.push(asst);
        let looped = [];
        let sp = selfPrompt;
        while (sp) {
          checkCancel(convo.openaiThreadId);
          const extra = await handleSelfPrompt(convo.openaiThreadId, assistantId, sp);
          looped.push(...extra);
          sp = runAssistantLoop.lastStatus === 'completed'
             ? null
             : runAssistantLoop.lastStatus.selfPrompt;
        }
        convo.messages.push(...looped);

        // f) persist
        await saveConversation(path.join(savedDir, `${localId}.txt`), convo);

        return {
          error: false,
          logs: allLogs,
          result: flattenContent(asst.content),
          threadId: localId,
          openaiThreadId: convo.openaiThreadId,
          assistantMessageId: asst.id
        };
      } catch (err) {
        // **Cancellation is final—don’t retry**
        if (err.message === 'Cancelled by user') {
          return {
            error: false,
            result: '🛑 Operation cancelled.',
            logs: allLogs,
            threadId: localId,
            openaiThreadId: convo.openaiThreadId
          };
        }

        // Otherwise record a retry and loop again (up to 3)
        allLogs.push({ type: 'retry', attempt, error: err.message });
        if (attempt === 3) {
          throw err;
        }
      }
    }
  } catch (err) {
    return { error: true, errorMessage: err.message, logs: allLogs };
  } finally {
    unlockThread(convo.openaiThreadId);
  }
}

// ─── Main assistant run loop, now using both throttles ─────────────
export async function runAssistantLoop(threadId, assistantId, instructions) {
  // initial cancel check
  checkCancel(threadId);
  logInfo(`Starting assistant loop (thread=${threadId})`);

  // reserve tokens & fire off the run
  const instrText = typeof instructions === 'string'
    ? instructions
    : JSON.stringify(instructions);
  await throttleByTokens(estimateTokensFromString(instrText));
  await rateLimit();

  const run = await createRunWithRateLimitRetry(
    threadId, assistantId, instructions, tools
  );

  const fnLogs = [];
  let selfPrompt = null;
  let status = run.status;

  while (true) {
    // allow cancellation before polling
    checkCancel(threadId);

    // this will throw if cancel arrives during polling
    const finished = await waitForRunCompletion(threadId, run.id);

    // one more check right as we come out of polling
    checkCancel(threadId);

    status = finished.status;
    logInfo(`Run ${run.id} → ${status}`);

    if (status === 'failed' || status === 'errored') {
      console.error(
        `Run ${run.id} failed:`,
        finished.last_error?.code,
        finished.last_error?.message
      );
      break;
    }

    if (status !== 'requires_action') {
      break;
    }

    // handle any required_action tool calls...
    const { fnLogs: newLogs, follow, selfPrompt: sp } =
      await runToolCalls(finished.required_action.submit_tool_outputs.tool_calls);
    fnLogs.push(...newLogs);
    selfPrompt = sp || selfPrompt;

    checkCancel(threadId);

    const outs = follow
      .filter(m => m.role === 'tool')
      .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }));

    logInfo(`API CALL: submitToolOutputs (batched)`);
    await submitToolOutputsInBatches(threadId, run.id, outs);
  }

  runAssistantLoop.lastStatus = status;
  return { fnLogs, selfPrompt };
}

// ─── Fetch or fallback assistant reply ────────────────────────────────
export async function fetchAssistantReply(threadId, fnLogs, lastStatus) {
  checkCancel(threadId);
  logInfo(`Listing last messages for thread ${threadId}`);
  await rateLimit();
  logInfo(`API CALL: list messages`);
  const { data: messages } = await openai.beta.threads.messages.list(
    threadId, { limit: 20, order: 'desc' }
  );
  let asst = messages.find(m => m.role === 'assistant');
  if (!asst || lastStatus !== 'completed') {
    const text = `⚠️ Error: run status ${lastStatus}`;
    logWarn(`No completed assistant message, synthesizing error reply`);
    asst = {
      id: `synthetic_${Date.now()}`,
      role: 'assistant',
      created_at: Math.floor(Date.now()/1000),
      content: [{ type:'text', text: { value: text, annotations: [] } }]
    };
  }
  return asst;
}

// ─── Self-prompt continuation ────────────────────────────────────────
export async function handleSelfPrompt(threadId, assistantId, selfPrompt) {
  checkCancel(threadId);
  logInfo(`handleSelfPrompt invoked`);
  logInfo(`Posting self-prompt user message`);
  const userMsg = await safeCreateMessage(threadId, {
    role: 'user',
    content: [{ type:'text', text: selfPrompt }]
  });

  await rateLimit();
  logInfo(`API CALL: create run for self-prompt`);
  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: assistantId });
  await waitForRunCompletion(threadId, run.id);

  await rateLimit();
  logInfo(`API CALL: list messages for self-prompt reply`);
  const { data } = await openai.beta.threads.messages.list(threadId, { limit:1 });
  logSuccess(`Self-prompt reply received`);
  return [userMsg, data[0]];
}
// ─── Flatten content array to text ───────────────────────────────────
export function flattenContent(contents) {
  return contents
    .map(c => typeof c.text === 'string' ? c.text : c.text.value)
    .join('\n');
}
