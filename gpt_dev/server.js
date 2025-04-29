import * as http  from 'http';
import * as https from 'https';
import * as fs    from 'fs';
import * as path  from 'path';
import * as fsp   from 'fs/promises';

import {
  getEnvVar,
  createHttpContext,
  attachWebSocketHandler,
  handleSse
} from './serverUtil.js';

import { SAVED_DIR } from './openaiConfig.js';
import { routesConfig } from './openaiRoutes.js'; // object: pattern → methods

// We don’t want to bind this server to 8080 (that’s your content server).
// Default API/WebSocket port is 3000.
const serverConfig = {
  protocol:  'http',
  host:      getEnvVar('HOST', 'localhost'),
  port:      Number(getEnvVar('PORT', '3000'))
};

// Ensure the saved-folder exists & start up
async function init() {
  await fsp.mkdir(SAVED_DIR, { recursive: true });
  startServer(serverConfig);
}

async function onRequest(req, res, cfg) {
  // CORS & preflight
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE,PUT,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsed = new URL(req.url || '/', `http://${req.headers.host}`);
  const { pathname, searchParams } = parsed;

  console.log(req.method,"request: ", parsed?.href);
  
  const method = req.method;

  // ① SSE endpoint:
  if (pathname === '/events') {
    // this will set text/event-stream headers
    return handleSse(req, res);
  }

  // If this is the WS endpoint, we’ll handle it in createServer’s upgrade listener
  if (pathname === '/ws') {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    return res.end('Upgrade Required');
  }

  /* ② serve / or /gptdev (with or without trailing slash) -> /gpt_dev/gpt_dev.html */
  if (method === 'GET' && (pathname === '/' || pathname === '/gptdev' || pathname === '/gptdev/')) {
    const filePath = path.join(process.cwd(), 'gpt_dev', 'gpt_dev.html');
    try {
      const stat = await fsp.stat(filePath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': stat.size
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
    return;
  }

  // --- Route dispatch ---
  // 1) Exact‐match
  let handler = routesConfig[pathname]?.[method];
  let params  = {};

  // 2) Parameterized match
  if (!handler) {
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

      const mhandler = methods[method];
      if (mhandler) {
        handler = mhandler;
        params = paramNames.reduce((o, name, i) => {
          o[name] = decodeURIComponent(m[i + 1]);
          return o;
        }, {});
        break;
      }
    }
  }

  if (handler) {
    const ctx = createHttpContext(
      req,
      res,
      params,
      Object.fromEntries(searchParams)
    );
    return Promise.resolve(handler(ctx))
      .catch(err => {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });
  }

  // No match → 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

function createServer(cfg) {
  const handler = (req, res) => onRequest(req, res, cfg);

  const server = cfg.protocol === 'https'
    ? https.createServer({
        key:  fs.readFileSync(cfg.keypath),
        cert: fs.readFileSync(cfg.certpath)
      }, handler)
    : http.createServer(handler);

  // Attach WS handler once, using the same routesConfig
  attachWebSocketHandler(server);

  return server;
}

function startServer(cfg) {
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`🚀 API & WS server running at http://${cfg.host}:${cfg.port}/`);
    console.log(`   → HTTP API on http://${cfg.host}:${cfg.port}/api/...`);
    console.log(`   → WS    on ws://${cfg.host}:${cfg.port}/ws`);
  });
}

init();
