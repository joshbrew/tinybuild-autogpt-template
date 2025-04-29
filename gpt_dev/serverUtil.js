import path from 'path';
import fs from 'fs/promises';
// import http from 'http';
// import https from 'https';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { routesConfig } from './openaiRoutes.js'; // pattern->methods object
import { createSession, createChannel } from 'better-sse';

dotenv.config();

export const RATE_LIMIT_INTERVAL_MS = 500; // Minimum interval between OpenAI API calls (500ms = 120 RPM)


// ─── Utils for colored logging ─────────────────────────────────────────
export const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m"
};
export function logInfo(msg)    { console.log(`${COLORS.cyan}[INFO]${COLORS.reset} ${msg}`); }
export function logSuccess(msg) { console.log(`${COLORS.green}[OK]${COLORS.reset}  ${msg}`); }
export function logWarn(msg)    { console.warn(`${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`); }
export function logError(msg)   { console.error(`${COLORS.red}[ERR]${COLORS.reset}  ${msg}`); }


export const sseChannel = createChannel();
export const pendingConsoleHistory = new Map();
/**
 * Get an environment variable, falling back to a default.
 */
export function getEnvVar(name, defaultValue) {
  return process.env[name] ?? defaultValue;
}

/**
 * Set common headers (incl. CORS) and status code on the response.
 */
export function setHeaders(response, statusCode, contentType = 'application/json') {
  response.writeHead(statusCode, {
    'Content-Type':                contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS, DELETE, PATCH',
    'Access-Control-Allow-Headers':'Content-Type'
  });
}

/**
 * Read the full request body as a string.
 */
export async function getRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

// --- Context factories ---
export function createHttpContext(req, res, params, query) {
  return {
    req,
    res,
    params,
    query,
    async json(status, data) {
      setHeaders(res, status, 'application/json');
      res.end(JSON.stringify(data));
    },
    async text(status, data) {
      setHeaders(res, status, 'text/plain');
      res.end(data);
    },
    async body() {
      return JSON.parse(await getRequestBody(req));
    },
  };
}

// --- HTTP handler export ---
export function httpHandler(req, res, next) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = findRoute(url.pathname);
  if (!route) return next();

  const handler = route.methods[req.method];
  if (!handler) {
    setHeaders(res, 405, 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const ctx = createHttpContext(
    req,
    res,
    route.params,
    Object.fromEntries(url.searchParams.entries())
  );
  handler(ctx).catch(err => {
    console.error(err);
    ctx.json(500, { error: err.message });
  });
}

export function createWsContext(ws, msg) {
  return {
    ws,
    params: msg.params || {},
    query: msg.query || {},
    async json(status, data) {
      ws.send(JSON.stringify({ status, data }));
    },
    async text(status, data) {
      ws.send(JSON.stringify({ status, data }));
    },
    body: msg.body || {},
  };
}

// --- WebSocket attachment export ---
export function attachWebSocketHandler(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', ws => {
    ws.on('message', async raw => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      }

      const route = findRoute(msg.path);
      if (!route) {
        return ws.send(JSON.stringify({ error: 'Not found' }));
      }

      const handler = route.methods[msg.method];
      if (!handler) {
        return ws.send(JSON.stringify({ error: 'Method not allowed' }));
      }

      const ctx = createWsContext(ws, msg);
      handler(ctx).catch(err => {
        console.error(err);
        ctx.json(500, { error: err.message });
      });
    });
  });
}

export async function handleSse(req, res) {
  // this will set the right headers and keep the connection open
  const session = await createSession(req, res);
  // register this client on our broadcast channel
  sseChannel.register(session);

  // now the client will receive ANY future broadcasts
}

// --- Route finder ---
export function findRoute(pathname) {
  // exact match
  if (routesConfig[pathname]) {
    return { methods: routesConfig[pathname], params: {} };
  }
  // parameterized match
  for (const [pattern, methods] of Object.entries(routesConfig)) {
    if (!pattern.includes('/:')) continue;

    const parts = pattern.split('/').filter(Boolean);
    const segs  = pathname.split('/').filter(Boolean);
    if (parts.length !== segs.length) continue;

    const paramNames = [];
    const regex = new RegExp(
      '^/' +
        parts
          .map(p => {
            if (p.startsWith(':')) {
              paramNames.push(p.slice(1));
              return '([^/]+)';
            }
            return p.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$'
    );
    const m = pathname.match(regex);
    if (!m) continue;

    const params = paramNames.reduce((o, name, i) => {
      o[name] = decodeURIComponent(m[i + 1]);
      return o;
    }, {});
    return { methods, params };
  }
  return null;
}

// ─── Flatten content array to text ───────────────────────────────────
export function flattenContent(contents) {
  return contents
    .map(c => typeof c.text === 'string' ? c.text : c.text.value)
    .join('\n');
}

// ─── Rate Limiting ───────────────────────────────────────────────────
let lastApiCallTime = 0;
export async function rateLimit() {
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


// Track user‐requested cancels
const cancelFlags = new Map();

/** Mark this thread as “please cancel” */
export function requestCancel(threadId) {
  cancelFlags.set(threadId, true);
}

/** Throw if someone asked to cancel this thread */
export function checkCancel(threadId) {
  if (cancelFlags.get(threadId)) {
    cancelFlags.delete(threadId);
    throw new Error('Cancelled by user');
  }
}