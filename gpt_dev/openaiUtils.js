// ./gpt_dev/openaiUtils.js

import path from 'path';
import fs from 'fs/promises';
import OpenAI from 'openai';
import { exec } from 'child_process';

// ─── Runtime config ─────────────────────────────────────────────────
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
export const SAVED_DIR = process.env.SAVED_DIR ||
  path.join(process.cwd(), 'gpt_dev/saved');
export const MODEL = process.env.GPT_MODEL || 'gpt-4.1';
export const ASSISTANT_FILE = path.join(SAVED_DIR, 'assistant.json');

// ─── System prompt & tool schemas ────────────────────────────────────
//todo: refine.
export const DEFAULT_SYSTEM_PROMPT = `
You are a server assistant running as a side server for a hot reloading web dev environment. 

Use the declared function calls to inspect or modify project files, execute shell commands, 
check browser console history. Be sure to be aware of your context window limitations when 
reading files and crawling the file system. Make sure you're careful to re-read files and other local 
dependencies between edits e.g. so you don't add elements in the index.html and in the index.js to clash for example.

If the user explicitly asks you to “go ahead and work on this yourself”, finish
your tool chain with **reprompt_self** to supply the follow‑up prompt you want 
to ask **yourself** and then you may continue calling reprompt_self recursively 
until you need feedback & testing. Do **not** call reprompt_self unless asked to work autonomously.

In our file system, gpt_dev contains the files relevant to this prompting environment
so safely ignore those unless the user specifies. 

Be sure to read files carefully and check the directory structure occasionally when editing.

The following are based on the project defaults, which should give you all the web or server bundling functionaliy you could need:

Also, note the starter file structure for this project and edit or build on top of it.
  **Root Files:**
- **.env**: Environment variables file.
- **.gitignore**: Specifies files not to track in Git.
- **favicon.ico**: Icon for the web app.
- **index.css**: Main stylesheet.
- **index.html**: Main HTML document.
- **index.js**: Contains a simple "HELLO WORLD" log.
- **package-lock.json**: Lockfile describing the installed versions of dependencies.
- **package.json**: Project metadata and dependencies.
- **README.md**: Project documentation.
- **tinybuild.config.js**: Configuration file for the Tinybuild tool.

Notes on the tinybuild.config.js:

It uses index.js as the entry point, for bundling css you can do e.g. "import 'index.css'" in the index.js file.
The bundler settings in it is just base esbuild plus some extra settings that are well documented in the file. 
You can add any generic esbuild settings or plugins to it. 
The server config serves a hot reloading development content server.
Note as in package.json, we are running the gpt chat server separately so it can be run in a separate window persistently 
while the content server hot reloads before your eyes. This includes css hot swapping without page refresh, or js/ts and other files triggering refresh.

Also note in the server settings of the config that you can add additional routes to the config so it can serve multiple pages.

const config = {
    //build:true, //enable this to skip serve step (same as cli)
    //serve:true //or enable this to skip build step (same as cli)
    bundler: { //esbuild settings, set false to skip build step or add bundle:true to config object to only bundle (alt methods)
      ... 
      tinybuild specific plus generic esbuild bundler settings e.g. 
      entryPoints: ['index.js','gpt_dev/gpt_dev.js']
      ...
    },
    server: {  //node server settings, set false to skip server step or add serve:true to config object to only serve (alt methods)
      ...
      routes:{ //set additional page routes (for sites instead of single page applications)
        '/gptdev': './gpt_dev/gpt_dev.html'
        //'/': 'index.html', //alt start page declaration
        //'/404':'packager/node_server/other/404.html', //e.g. custom error page
        //'/page2': 'mypage.html',
        //'/custom':{ //e.g. custom page template
        //    headers: { 'Content-Security-Policy': '*' }, //page specific headers 
        //    template:'<html><head></head><body><div>Hello World!</div></body></html>'
            //path: 'mypage.html' //or a file path (e.g. plus specific headers)
            //onrequest: (request,response) => {}, //custom request/response handling, return true to end the request automatically.
        //},
        //'/redirect':{ //e.g. custom redirect
        //    redirect:'https://google.com'
        //},
        //'/other':(request,response) => {}, //custom request/response handling, return true to end the request automatically.
      },
      ...  
    },
    /*
    mobile:{ //this will copy the dist and index.html to capacitor builds that can create small interoperable javascript webview + native functionality (e.g. bluetooth) mobile apps (~2Mb at minimum). 
        android:'open', //'open'//true //Requires Android Studio, it will be launched
        ios:false //'open'//true //Requires XCode 
    },
    electron:true, //desktop apps as a full chromium bundle, not small and needs some customization for things like bluetooth menus. Better for full featured applications. Can trigger backend runtimes on local machines.
    tauri:true, //alternative tauri build options for very minimal native engine desktop apps that generally lack the latest web APIs. Good for simple apps, you can bundle it with backend runtimes on local machines.
    assets:[ //for the mobile/desktop bundlers to copy into their respective folders
        './assets',
        './favicon.ico'
    ]
    */
}

There's much more but that is the most essential 
feature you might tweak in a multi page environment, 
but generally stick to single page applications and import 
assets to index.js to bundle. Refer to https://github.com/joshbrew/tinybuild for more info.

Also note we can bundle worker files automatically by just importing the worker with a 'worker.js/ts' in the file somewhere
then you apply that imported file e.g. like import wrkr from 'my.worker.js' then new Worker(wrkr); This is *very* important for faster bundled multithreaded applications!!

The default index.html is formatted like:

<!DOCTYPE html>
<html>
    <head>
        <link rel="stylesheet" href="dist/index.css">
    </head>
    <body>  
        <script src="dist/index.js">
        </script>
    </body>
</html>
        

So the index.js and css get bundled to the dist folder and that 
bundled copy is referenced as esbuild strips out ts and other issues.

Generally, it's best to not touch this and work from index.js and build the 
page programmatically. esbuild natively supports jsx/tsx as well for react/preact/etc.

Happy coding! You are now the self aware code monkey server of the 
future. Give it your best most professional, readable, and sensibly 
modular work that can overcome context limitations e.g. extremely clean code with various logic archetypes consolidated
plus documentation blocks thrown up front for a quick summary of functionality and so on in a way that the LLM
can best retain memory while reading/writing to a file system.

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
    }//,
    // {
    //   name: 'get_console_history',
    //   description: 'Return the browser’s console.log/info/warn/error history as JSON',
    //   parameters: {
    //     type: 'object',
    //     properties: { },
    //     required: []
    //   }
    // }
];
  
export const tools = functionSchemas.map(fn => ({ type:'function', function:fn }));

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

// ─── Tool‐calling runner ───────────────────────────────────────────────
export async function runToolCalls(toolCalls) {
  const fnLogs = [], follow = [];
  let selfPrompt = null;
  const root = process.cwd();
  const safe = (...p) => path.join(root, ...p);

  const makeWalker = opts => async function walk(dir) {
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

  for (const tc of toolCalls) {
    const name = tc.function?.name ?? tc.name;
    const args = JSON.parse(tc.function?.arguments ?? tc.arguments);
    let result = '';

    switch (name) {
      case 'read_file': {
        const fp = safe(args.folder, args.filename);
        const txt = await fs.readFile(fp, 'utf-8');
        const st = await fs.stat(fp);
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
      case 'list_directory': {
        const walker = makeWalker({
          recursive:         args.recursive,
          skip_node_modules: args.skip_node_modules !== false,
          deep_node_modules: args.deep_node_modules === true
        });
        result = JSON.stringify(await walker(safe(args.folder||'.')));
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
      case 'run_shell': {
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
      case 'reprompt_self':
        selfPrompt = args.new_prompt;
        result = 'Scheduled self-prompt';
        break;
      // get_console_history would go here...


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
  })

  return { fnLogs, follow, selfPrompt };
}

// ─── Thread & run helpers ────────────────────────────────────────────
export async function waitForRunCompletion(threadId, runId) {
  await rateLimit();
  let run = await openai.beta.threads.runs.retrieve(threadId, runId);
  while (['queued','in_progress'].includes(run.status)) {
    await new Promise(r => setTimeout(r, 500));
    await rateLimit();
    run = await openai.beta.threads.runs.retrieve(threadId, runId);
  }
  return run;
}

export async function clearActiveRuns(threadId) {
  let cursor = null;
  do {
    const res = await openai.beta.threads.runs.list(threadId, {
      limit: 50,
      ...(cursor ? { cursor } : {})
    });
    for (const r of res.data) {
      if (['queued', 'in_progress'].includes(r.status)) {
        try {
          await rateLimit();
          await openai.beta.threads.runs.del(threadId, r.id);
        } catch {
          // ignore individual delete errors
        }
      }
    }
    cursor = res.next_cursor;
  } while (cursor);
}

/**
 * Waits for any queued, in-progress, or requires_action runs to complete before proceeding.
 */
export async function waitForActiveRuns(threadId) {
  let cursor = null;
  do {
    const res = await openai.beta.threads.runs.list(threadId, {
      limit: 50,
      ...(cursor ? { cursor } : {})
    });
    for (const r of res.data) {
      if (['queued', 'in_progress', 'requires_action'].includes(r.status)) {
        // If waiting on your tool outputs, drive it to completion
        if (r.status === 'requires_action') {
          const { fnLogs: newLogs, follow, selfPrompt } =
            await runToolCalls(r.required_action.submit_tool_outputs.tool_calls);
          await rateLimit();
          await openai.beta.threads.runs.submitToolOutputs(threadId, r.id, {
            tool_outputs: follow
              .filter(m => m.role === 'tool')
              .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }))
          });
        }
        // then wait for it to finish
        await waitForRunCompletion(threadId, r.id);
      }
    }
    cursor = res.next_cursor;
  } while (cursor);
}

export async function safeCreateMessage(threadId, params) {
  while (true) {
    try {
      await rateLimit();
      return await openai.beta.threads.messages.create(threadId, params);
    } catch (err) {
      if (err.status === 400 && err.error?.message.includes('active run')) {
        // first let any legitimate runs finish
        await waitForActiveRuns(threadId);
        // then clear only true orphans
        await clearActiveRuns(threadId);
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

// ─── Utils for colored logging ─────────────────────────────────────────
const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m"
};
function logInfo(msg)    { console.log(`${COLORS.cyan}[INFO]${COLORS.reset} ${msg}`); }
function logSuccess(msg) { console.log(`${COLORS.green}[OK]${COLORS.reset}  ${msg}`); }
function logWarn(msg)    { console.warn(`${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`); }
function logError(msg)   { console.error(`${COLORS.red}[ERR]${COLORS.reset}  ${msg}`); }

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

// ─── Core prompt flow ─────────────────────────────────────────────────
export async function handlePrompt({ prompt, threadId, title, systemPrompt }, savedDir) {
  if (!prompt?.trim()) {
    return { error: true, errorMessage: 'Missing prompt', logs: [] };
  }

  let allLogs = [];
  let convo, localId, assistantId;

  // initial setup
  assistantId = await ensureAssistant();
  ({ localId, convo } = await initConversation(threadId, title, savedDir));

  // acquire thread lock
  await lockThread(convo.openaiThreadId);
  try {
    // ensure no stray runs before starting
    if (convo.openaiThreadId) {
      await waitForActiveRuns(convo.openaiThreadId);
      await clearActiveRuns(convo.openaiThreadId);
    }

    // Try up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // before posting the user message, wait & clear any active runs
        if (convo.openaiThreadId) {
          await waitForActiveRuns(convo.openaiThreadId);
          await clearActiveRuns(convo.openaiThreadId);
        }

        // 1) post user message
        const userMsg = await postUserMessage(convo.openaiThreadId, prompt);
        convo.messages.push(userMsg);

        // 2) run assistant + tools
        const { fnLogs, selfPrompt } = await runAssistantLoop(
          convo.openaiThreadId,
          assistantId,
          systemPrompt || DEFAULT_SYSTEM_PROMPT
        );
        allLogs.push(...fnLogs);

        // 3) fetch assistant reply
        const asst = await fetchAssistantReply(
          convo.openaiThreadId,
          fnLogs,
          runAssistantLoop.lastStatus
        );
        if (runAssistantLoop.lastStatus !== 'completed') {
          throw new Error(`Run failed with status ${runAssistantLoop.lastStatus}`);
        }
        convo.messages.push(asst);

        // 4) optional self-prompt
        if (selfPrompt) {
          const extra = await handleSelfPrompt(convo.openaiThreadId, assistantId, selfPrompt);
          convo.messages.push(...extra);
        }

        // 5) save conversation
        await saveConversation(path.join(savedDir, `${localId}.txt`), convo);

        // SUCCESS
        return {
          error: false,
          logs: allLogs,
          result: flattenContent(asst.content),
          threadId: localId,
          openaiThreadId: convo.openaiThreadId,
          userMessageId: userMsg.id,
          assistantMessageId: asst.id
        };

      } catch (err) {
        // record this retry
        allLogs.push({ type: 'retry', attempt, error: err.message });

        if (attempt === 3) {
          // on last attempt, bubble the error out to outer catch
          throw err;
        }

        // Clear stuck runs before retrying
        try {
          if (convo.openaiThreadId) {
            await clearActiveRuns(convo.openaiThreadId);
          }
        } catch {}
        continue;
      }
    }
  } catch (err) {
    return { error: true, errorMessage: err.message, logs: allLogs };
  } finally {
    // always release the lock
    try { unlockThread(convo.openaiThreadId); } catch {}
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

// ─── Assistant/tool run loop ─────────────────────────────────────────
export async function runAssistantLoop(threadId, assistantId, instructions) {
  logInfo(`Starting assistant loop (thread=${threadId}, assistant=${assistantId})`);
  let status;
  const fnLogs = [];
  let selfPrompt;

  await rateLimit();
  logInfo(`API CALL: create run`);
  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
    instructions,
    tools,
    tool_choice: 'auto'
  });
  logSuccess(`Run created (id=${run.id})`);

  while (true) {
    logInfo(`Waiting for run ${run.id} completion`);
    run = await waitForRunCompletion(threadId, run.id);
    status = run.status;
    logInfo(`Run status: ${status}`);
    if (status !== 'requires_action') break;

    logInfo(`Submitting tool outputs`);
    const { fnLogs: newLogs, follow, selfPrompt: sp } =
      await runToolCalls(run.required_action.submit_tool_outputs.tool_calls);
    fnLogs.push(...newLogs);
    selfPrompt = sp || selfPrompt;

    await rateLimit();
    logInfo(`API CALL: submitToolOutputs`);
    await openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
      tool_outputs: follow
        .filter(m => m.role === 'tool')
        .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }))
    });
  }

  runAssistantLoop.lastStatus = status;
  return { fnLogs, selfPrompt };
}

// ─── Fetch or fallback assistant reply ────────────────────────────────
export async function fetchAssistantReply(threadId, fnLogs, lastStatus) {
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
  logInfo(`handleSelfPrompt invoked`);
  await clearActiveRuns(threadId);
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
