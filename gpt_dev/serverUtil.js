import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { routesConfig } from './openaiRoutes.js'; // pattern->methods object
import { createSession, createChannel } from 'better-sse';

dotenv.config();

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

