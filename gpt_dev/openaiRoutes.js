// /backend/openaiRoutes.js
import path   from 'path';
import * as fsp from 'fs/promises';
import OpenAI  from 'openai';
import { getRequestBody, setHeaders } from './serverUtil.js';

import { exec } from 'child_process';

/* ────────── runtime config ────────── */
export const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const SAVED_DIR = process.env.SAVED_DIR || path.join(process.cwd(), 'gpt_dev/saved');
export const MODEL     = process.env.GPT_MODEL  || 'gpt-4.1'; //'gpt-4o'
export const ASSISTANT_FILE = path.join(SAVED_DIR, 'assistant.json');
console.debug(`[openaiRoutes] SAVED_DIR=${SAVED_DIR} • MODEL=${MODEL}`);

/* ────────── extensive system prompt for the build environment (not foolproof) ─────────── */

//todo: refine, teach it how our web worker bundling works, maybe server bundling and other stuff but it's still a bit of a dodgy assistant system still.
const DEFAULT_SYSTEM_PROMPT = `
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

There's much more but that is the most essential feature you might tweak in a multi page environment, but generally stick to single page applications and import assets to index.js to bundle.\

The index.html is 

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
const functionSchemas = [
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
  },
  {
    name: 'get_console_history',
    description: 'Return the browser’s console.log/info/warn/error history as JSON',
    parameters: {
      type: 'object',
      properties: { },
      required: []
    }
  }
];

const tools = functionSchemas.map(fn => ({ type:'function', function:fn }));

/* ─── runToolCalls implementation ──────────────────────────────────── */
async function runToolCalls(toolCalls) {
  const fnLogs = [], follow = [];
  let selfPrompt = null;
  const root = process.cwd();
  const safe = (...p) => path.join(root, ...p);

  const makeWalker = opts => async function walk(dir) {
    const out = [];
    for (const e of await fsp.readdir(dir, { withFileTypes:true })) {
      if (e.name==='dist') continue;
      if (e.name==='node_modules') {
        if (opts.skip_node_modules) continue;
        if (!opts.deep_node_modules) {
          // top‑level only
          const pkgs = await fsp.readdir(path.join(dir,'node_modules'));
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

    switch(name) {
      case 'read_file': {
        const fp = safe(args.folder, args.filename);
        const txt = await fsp.readFile(fp,'utf-8');
        const st  = await fsp.stat(fp);
        result = JSON.stringify({
          content:      txt,
          byteLength:   st.size,
          modifiedTime: st.mtime.toISOString()
        });
        break;
      }
      case 'write_file': {
        const dir = safe(args.folder);
        await fsp.mkdir(dir,{recursive:true});
        const fp = safe(args.folder,args.filename);
        let existing='';
        try{ existing = await fsp.readFile(fp,'utf-8'); }catch{}
        let out = args.content;
        if (args.replace_range) {
          out = existing.slice(0,args.replace_range.start)
              + args.content
              + existing.slice(args.replace_range.end);
        } else if (Number.isInteger(args.insert_at)) {
          const p = args.insert_at;
          out = existing.slice(0,p) + args.content + existing.slice(p);
        }
        await fsp.writeFile(fp,out,'utf-8');
        const st = await fsp.stat(fp);
        result = JSON.stringify({ byteLength: st.size });
        break;
      }
      case 'list_directory': {
        const walker = makeWalker({
          recursive:          args.recursive,
          skip_node_modules:  args.skip_node_modules !== false,
          deep_node_modules:  args.deep_node_modules === true
        });
        result = JSON.stringify(await walker(safe(args.folder||'.')));
        break;
      }
      case 'move_file': {
        const src = safe(args.source);
        const dst = safe(args.destination);
        await fsp.mkdir(path.dirname(dst),{recursive:true});
        await fsp.rename(src,dst);
        result = `Moved ${args.source} → ${args.destination}`;
        break;
      }
      case 'remove_directory': {
        await fsp.rm(safe(args.folder),{
          recursive: args.recursive !== false,
          force:true
        });
        result = `Removed directory ${args.folder}`;
        break;
      }
      case 'rename_file': {
        // Same-folder rename
        const dir      = safe(args.folder);
        const oldPath  = path.join(dir, args.old_filename);
        const newPath  = path.join(dir, args.new_filename);
        await fsp.rename(oldPath, newPath);
        result = `Renamed ${args.old_filename} → ${args.new_filename}`;
        break;
      }
      case 'reprompt_self': {
        selfPrompt = args.new_prompt;
        result     = 'Scheduled self‑prompt';
        break;
      }
      case 'run_shell': {
        // Execute the requested shell command in project root
        
        result = await new Promise(resolve => {
          console.log("Executing: ", args.command);
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
    }

    fnLogs.push({ type:'function_call',   name, arguments:args });
    fnLogs.push({ type:'function_result', name, result });
    follow.push(
      { role:'assistant', tool_calls:[tc] },
      { role:'tool', tool_call_id:tc.id, name, content:result }
    );
  }

  return { fnLogs, follow, selfPrompt };
}

// Helper: wait for a Threads run to finish
async function waitForRunCompletion(openai, threadId, runId) {
  console.debug(`[openaiRoutes] waitForRunCompletion: thread=${threadId}, run=${runId}`);
  let run = await openai.beta.threads.runs.retrieve(threadId, runId);
  console.debug(`[openaiRoutes] initial run status: ${run.status}`);
  while (['queued', 'in_progress'].includes(run.status)) {
    console.debug(`[openaiRoutes] polling run ${runId}, status=${run.status}`);
    await new Promise(r => setTimeout(r, 500));
    run = await openai.beta.threads.runs.retrieve(threadId, runId);
  }
  console.debug(`[openaiRoutes] run ${runId} completed: ${run.status}`);
  return run;
}

/**
 * Check the last few runs in this thread, and if any are still
 * queued/in_progress, await their completion.
 */
async function ensureNoActiveRun(threadId) {
  console.debug(`[openaiRoutes] ensureNoActiveRun on ${threadId}`);
  let hasActive;
  do {
    hasActive = false;
    const runsList = await openai.beta.threads.runs.list(threadId, { limit: 20 });
    for (const r of runsList.data) {
      if (['queued','in_progress'].includes(r.status)) {
        hasActive = true;
        console.debug(`[openaiRoutes] waiting on active run ${r.id} (${r.status})`);
        await waitForRunCompletion(openai, threadId, r.id);
        break;
      }
    }
  } while (hasActive);
}


// Helper to make sure no runs are active, or cancel them all:
async function clearActiveRuns(threadId) {
  console.debug('[openaiRoutes] clearActiveRuns on', threadId);
  const runs = await openai.beta.threads.runs.list(threadId, { limit: 50 });
  for (const r of runs.data) {
    //console.log(r.status);
    if (['queued','in_progress'].includes(r.status)) {
      console.debug(`[openaiRoutes] cancelling stuck run ${r.id} (${r.status})`);
      try {
        await openai.beta.threads.runs.del(threadId, r.id);
        console.debug(`[openaiRoutes] cancelled run ${r.id}`);
      } catch (e) {
        console.warn(`[openaiRoutes] failed to cancel run ${r.id}:`, e);
      }
    }
  }
}


// Wrapper around messages.create() that retries after clearing runs
async function safeCreateMessage(threadId, params) {
  while (true) {
    try {
      return await openai.beta.threads.messages.create(threadId, params);
    } catch (err) {
      if (err.status === 400 && err.error?.message.includes('active run')) {
        console.debug('[openaiRoutes] safeCreateMessage: active run, clearing then retrying');
        await clearActiveRuns(threadId);
        continue;
      }
      throw err;
    }
  }
}

const threadLocks = new Map();
/** Wait until no one else holds the lock, then lock it */
async function lockThread(threadId) {
  while (threadLocks.get(threadId)) {
    await new Promise(r => setTimeout(r, 100));
  }
  threadLocks.set(threadId, true);
}
/** Release the lock */
function unlockThread(threadId) {
  threadLocks.delete(threadId);
}

async function loadConversation(fp) {
  try {
    const raw  = await fsp.readFile(fp, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return { messages: data, openaiThreadId: null, title: '' };
    }
    return {
      messages:       data.messages       || [],
      openaiThreadId: data.openaiThreadId || null,
      title:          data.title          || ''
    };
  } catch {
    return { messages: [], openaiThreadId: null, title: '' };
  }
}

async function saveConversation(fp, convo) {
  await fsp.mkdir(path.dirname(fp), { recursive:true });
  await fsp.writeFile(fp,
    JSON.stringify({
      openaiThreadId: convo.openaiThreadId,
      title:          convo.title,
      messages:       convo.messages
    }, null,2),
    'utf-8'
  );
}
/* ─── ensure we have exactly one assistant ───────────────────────────────── */
async function ensureAssistant() {
  let existing;
  try {
    const raw = await fsp.readFile(ASSISTANT_FILE, 'utf-8');
    existing = JSON.parse(raw);
  } catch {
    existing = null;
  }

  const currentInstr = DEFAULT_SYSTEM_PROMPT.trim();

  // If we have an existing assistant and its instructions match, just reuse it
  if (existing?.assistantId && existing.instructions === currentInstr) {
    console.debug('[openaiRoutes] using assistant:', existing.assistantId);
    return existing.assistantId;
  }

  // Otherwise, if there’s an old assistant, delete it
  if (existing?.assistantId) {
    console.debug('[openaiRoutes] deleting old assistant:', existing.assistantId);
    try {
      await openai.beta.assistants.del(existing.assistantId);
      console.debug('[openaiRoutes] old assistant deleted');
    } catch (err) {
      console.warn('[openaiRoutes] failed to delete old assistant:', err);
    }
  } else {
    console.debug('[openaiRoutes] no assistant found, creating new one…');
  }

  // Create a brand‑new assistant
  console.debug('[openaiRoutes] creating new assistant…');
  const asst = await openai.beta.assistants.create({
    name:         'Server Assistant',
    instructions: currentInstr,
    tools:        [],  // function‑calling only
    model:        MODEL
  });
  const assistantId = asst.id;
  console.debug('[openaiRoutes] new assistant created:', assistantId);

  // Persist its ID and the prompt
  await fsp.mkdir(path.dirname(ASSISTANT_FILE), { recursive: true });
  await fsp.writeFile(
    ASSISTANT_FILE,
    JSON.stringify({ assistantId, instructions: currentInstr }, null, 2),
    'utf-8'
  );
  console.debug('[openaiRoutes] saved assistantId:', assistantId);

  return assistantId;
}



/* ─── routes ───────────────────────────────────────────────────────── */
export const apiRoutes = {

  /* ---------- thread list with titles ---------- */
  '/api/threads': {
    GET: async (_, res) => {
      const files = (await fsp.readdir(SAVED_DIR))
        .filter(f => f.endsWith('.txt'))
        .map(f => f.slice(0, -4));

      const threads = await Promise.all(
        files.map(async localId => {
          const convo = await loadConversation(path.join(SAVED_DIR, localId + '.txt'));
          return {
            id:               localId,
            title:            convo.title || localId,
            openaiThreadId:   convo.openaiThreadId   // ← include this
          };
        })
      );

      setHeaders(res, 200, 'application/json');
      res.end(JSON.stringify(threads));
    }
  },

  /* ---------- load one convo (title + messages) ---------- */
  '/api/threads/:id': {
    GET: async (req, res) => {
      const localId = req.params.id;
      const fp = path.join(SAVED_DIR, `${localId}.txt`);

      try {
        const convo = await loadConversation(fp);
        setHeaders(res, 200, 'application/json');
        res.end(JSON.stringify({
          id:               localId,           // ← include this too
          title:            convo.title,
          openaiThreadId:   convo.openaiThreadId,
          messages:         convo.messages
        }));
      } catch {
        setHeaders(res, 404, 'application/json');
        res.end('{"error":"Thread not found"}');
      }
    }
  },

  /* ---------- rename a convo title ---------- */
  '/api/threads/:id/title': {
    POST: async (req, res) => {
      const { title, id } = JSON.parse(await getRequestBody(req));
      if (!title || typeof title !== 'string') {
        setHeaders(res,400,'application/json');
        return res.end(JSON.stringify({ error:'Missing or invalid title' }));
      }

      const filePath = path.join(SAVED_DIR, `${id}.txt`);
      let convo;
      try { convo = await loadConversation(oldPath); }
      catch { convo = { messages:[], openaiThreadId:null, title:'' }; }

      convo.title = title;
      await saveConversation(filePath, convo);

      if (convo.openaiThreadId) {
        await openai.beta.threads.update(convo.openaiThreadId, { metadata:{ title } });
      }

      setHeaders(res,200,'application/json');
      res.end(JSON.stringify({ id, title }));
    }
  },

  /* -- Thread management -- */
  '/api/threads/:thread_id': {
    GET: async (req,res) => {
      const localId = req.params.thread_id;
      const convo   = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }
      const thread = await openai.beta.threads.retrieve(convo.openaiThreadId);
      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(thread));
    },
    POST: async (req,res) => {
      const localId = req.params.thread_id;
      const convo   = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }
      const body = JSON.parse(await getRequestBody(req));
      const updated = await openai.beta.threads.update(convo.openaiThreadId, {
        metadata:       body.metadata,
        tool_resources: body.tool_resources ?? null
      });
      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(updated));
    },
    DELETE: async (req,res) => {
      const localId = req.params.thread_id;
      const convo   = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }
      // delete on OpenAI
      const deleted = await openai.beta.threads.del(convo.openaiThreadId);
      // delete local file
      await fsp.unlink(path.join(SAVED_DIR, `${localId}.txt`)).catch(()=>{});
      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(deleted));
    }
  },

  /* -- Message management -- */
  '/api/threads/:thread_id/messages': {
    GET: async (req,res) => {
      const localId = req.params.thread_id;
      const convo   = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }
      const url  = new URL(req.url, `http://${req.headers.host}`);
      const list = await openai.beta.threads.messages.list(convo.openaiThreadId, {
        limit:  Number(url.searchParams.get('limit') || 20),
        order:  url.searchParams.get('order') || 'desc',
        after:  url.searchParams.get('after')  || undefined,
        before: url.searchParams.get('before') || undefined
      });
      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(list));
    },
    POST: async (req,res) => {
      const localId = req.params.thread_id;
      let convo     = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }

      const body = JSON.parse(await getRequestBody(req));
      // ensure each content item has a type
      const content = (body.content || []).map(c => ({
        type: c.type || 'text',
        text: c.text
      }));

      // create message on OpenAI
      const msg = await openai.beta.threads.messages.create(convo.openaiThreadId, {
        role:        body.role,
        content,
        attachments: body.attachments,
        metadata:    body.metadata
      });

      // save it locally
      convo.messages.push(msg);
      await saveConversation(path.join(SAVED_DIR, `${localId}.txt`), convo);

      setHeaders(res,201,'application/json');
      res.end(JSON.stringify(msg));
    }
  },

  '/api/threads/:thread_id/messages/:message_id': {
    GET: async (req,res) => {
      const { thread_id: localId, message_id: mid } = req.params;
      const convo = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }
      const msg = await openai.beta.threads.messages.retrieve(convo.openaiThreadId, mid);
      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(msg));
    },
    POST: async (req,res) => {
      const { thread_id: localId, message_id: mid } = req.params;
      let convo = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }

      const body = JSON.parse(await getRequestBody(req));
      const content = (body.content || []).map(c => ({
        type: c.type || 'text',
        text: c.text
      }));

      const updated = await openai.beta.threads.messages.update(
        convo.openaiThreadId,
        mid,
        { content, metadata: body.metadata }
      );

      // overwrite in local save
      convo.messages = convo.messages.map(m => m.id === mid ? updated : m);
      await saveConversation(path.join(SAVED_DIR, `${localId}.txt`), convo);

      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(updated));
    },
    DELETE: async (req,res) => {
      const { thread_id: localId, message_id: mid } = req.params;
      let convo = await loadConversation(path.join(SAVED_DIR, `${localId}.txt`));
      if (!convo.openaiThreadId) {
        setHeaders(res,404,'application/json');
        return res.end('{"error":"No OpenAI thread mapped"}');
      }

      // delete on OpenAI
      const del = await openai.beta.threads.messages.del(convo.openaiThreadId, mid);
      // remove locally
      convo.messages = convo.messages.filter(m => m.id !== mid);
      await saveConversation(path.join(SAVED_DIR, `${localId}.txt`), convo);

      setHeaders(res,200,'application/json');
      res.end(JSON.stringify(del));
    }
  },

  '/api/files': {
    GET: async (req,res)=>{
      const url = new URL(req.url,`http://${req.headers.host}`);
      const params = {
        folder:            '.',
        recursive:         url.searchParams.get('recursive')!=='false',
        skip_node_modules: url.searchParams.get('skip_node_modules')!=='false',
        deep_node_modules: url.searchParams.get('deep_node_modules')==='true'
      };
      const { fnLogs } = await runToolCalls([{
        id:        'files',
        name:      'list_directory',
        function:  {},
        arguments: JSON.stringify(params)
      }]);
      setHeaders(res,200,'application/json');
      res.end(fnLogs.at(-1).result);
    }
  },

  
  '/api/prompt': {
    POST: async (req, res, { savedDir }) => {
      console.debug('[openaiRoutes] /api/prompt POST');
      let lockId = null;

      try {
        /* 1 – input */
        const body   = JSON.parse(await getRequestBody(req));
        const prompt = (body.prompt || '').trim();
        if (!prompt) {
          setHeaders(res, 400, 'application/json');
          return res.end('{"error":"Missing prompt"}');
        }

        /* 2 – assistant */
        const assistantId = await ensureAssistant();

        /* 3 – thread */
        let localId, convo;
        if (body.threadId) {
          localId = body.threadId;
          convo   = await loadConversation(path.join(savedDir, `${localId}.txt`));
        } else {
          const thread = await openai.beta.threads.create();
          localId = thread.id;
          convo   = { messages: [], openaiThreadId: thread.id, title: '' };
        }
        if (!convo.title && body.title) convo.title = body.title;

        /* 4 – lock */
        lockId = convo.openaiThreadId;
        await lockThread(lockId);

        /* 5 – clean slate */
        await clearActiveRuns(convo.openaiThreadId);

        /* 6 – user message */
        const userMsg = await safeCreateMessage(
          convo.openaiThreadId,
          { role:'user', content:[{ type:'text', text:prompt }] }
        );
        convo.messages.push(userMsg);

        /* 7 – initial run */
        let run = await openai.beta.threads.runs.create(
          convo.openaiThreadId,
          {
            assistant_id : assistantId,
            instructions : body.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            tools,
            tool_choice  : 'auto'
          }
        );

        /* 8 – run / tool-call loop */
        let fnLogs = [], selfPrompt;
        while (true) {
          run = await waitForRunCompletion(openai, convo.openaiThreadId, run.id);
          if (run.status !== 'requires_action') break;

          const { fnLogs:newLogs, follow, selfPrompt:sp } =
                await runToolCalls(run.required_action.submit_tool_outputs.tool_calls);
          fnLogs.push(...newLogs);
          selfPrompt = sp ?? selfPrompt;

          await openai.beta.threads.runs.submitToolOutputs(
            convo.openaiThreadId,
            run.id,
            {
              tool_outputs: follow
                .filter(m => m.role === 'tool')
                .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }))
            }
          );
        }

        /* 9 – get the newest assistant message (if any) */
        const { data: msgs } = await openai.beta.threads.messages.list(
          convo.openaiThreadId, { limit: 20, order: 'desc' }
        );
        let asst = msgs.find(m => m.role === 'assistant');

        /* 10 – if run failed OR no assistant message, create fallback reply */
        if (!asst || run.status !== 'completed') {
          const fallbackText =
            `⚠️ I ran into a problem while processing your request ` +
            `(run status: **${run.status}**). Please try again or revise your prompt.`;

          asst = {
            id: `synthetic_${Date.now()}`,
            role: 'assistant',
            created_at: Math.floor(Date.now() / 1000),
            content: [{ type:'text', text:{ value:fallbackText, annotations:[] } }]
          };
        }

        convo.messages.push(asst);

        /* 11 – optional selfPrompt */
        if (selfPrompt) {
          await clearActiveRuns(convo.openaiThreadId);
          const spMsg = await safeCreateMessage(
            convo.openaiThreadId,
            { role:'user', content:[{ type:'text', text:selfPrompt }] }
          );
          convo.messages.push(spMsg);

          let spRun = await openai.beta.threads.runs.create(
            convo.openaiThreadId, { assistant_id: assistantId }
          );
          spRun = await waitForRunCompletion(openai, convo.openaiThreadId, spRun.id);

          const { data:[lastAssistant] } = await openai.beta.threads.messages.list(
            convo.openaiThreadId, { limit: 1 }
          );
          convo.messages.push(lastAssistant);
        }

        /* 12 – persist & respond */
        await saveConversation(path.join(savedDir, `${localId}.txt`), convo);

        setHeaders(res, 200, 'application/json');
        const resultText = asst.content
          .map(c => typeof c.text === 'string' ? c.text : (c.text?.value || ''))
          .join('\n');

        res.end(JSON.stringify({
          logs : fnLogs,
          result : resultText,
          threadId : localId,
          openaiThreadId : convo.openaiThreadId
        }));
      } catch (err) {
        console.error('[openaiRoutes] /api/prompt error:', err);
        setHeaders(res, 500, 'application/json');
        res.end('{"error":"Internal Server Error"}');
      } finally {
        if (lockId) unlockThread(lockId);
      }
    }
  }


};
