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

import { SAVED_DIR } from './clientConfig.js';
import { routesConfig as openaiRoutes } from './openaiRoutes.js';
import { routesConfig as gitRoutes } from './gitHelper.js'


//aggregate route definitions
const routesConfig = {
  ...openaiRoutes,
  ...gitRoutes
};

// Default API/WebSocket port is 3000 (content on 8080 elsewhere)
const serverConfig = {
  protocol: 'http',
  host:     getEnvVar('HOST', 'localhost'),
  port:     Number(getEnvVar('PORT', '3000'))
};

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
  const method = req.method;
  console.log(method, 'request:', parsed.href);

  // SSE endpoint
  if (pathname === '/events') {
    return handleSse(req, res);
  }
  // WS endpoint
  if (pathname === '/ws') {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    return res.end('Upgrade Required');
  }

  // Serve root HTML
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

  // --- General static file serving ---
  if (method === 'GET') {
    // Resolve local file path relative to project root
    let safePath = path.normalize(path.join(process.cwd(), pathname));
    if (safePath.startsWith(process.cwd())) {
      try {
        const stat = await fsp.stat(safePath);
        if (stat.isFile()) {
          // Determine MIME type
          const ext = path.extname(safePath).toLowerCase();
          const mimeTypes = {
            '.js':   'application/javascript',
            '.css':  'text/css',
            '.html': 'text/html; charset=utf-8',
            '.json': 'application/json',
            '.png':  'image/png',
            '.jpg':  'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg':  'image/svg+xml',
            '.ico':  'image/x-icon'
          };
          const contentType = mimeTypes[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size
          });
          return fs.createReadStream(safePath).pipe(res);
        }
      } catch {
        // File doesn't exist, fall through to route dispatch
      }
    }
  }

  // --- API route dispatch ---
  let handler = routesConfig[pathname]?.[method];
  let params = {};
  if (!handler) {
    for (const [pattern, methods] of Object.entries(routesConfig)) {
      if (!pattern.includes('/:')) continue;
      const parts = pattern.split('/').filter(Boolean);
      const segs  = pathname.split('/').filter(Boolean);
      if (parts.length !== segs.length) continue;
      const paramNames = [];
      const regex = new RegExp(
        '^/' + parts.map(p => p.startsWith(':')
          ? (() => { paramNames.push(p.slice(1)); return '([^/]*)'; })()
          : p.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
        ).join('/') + '/?$'
      );
      const m = pathname.match(regex);
      if (!m) continue;
      const mhandler = methods[method];
      if (mhandler) {
        handler = mhandler;
        params = paramNames.reduce((o, name, i) => (o[name] = decodeURIComponent(m[i+1]), o), {});
        break;
      }
    }
  }

  if (handler) {
    const ctx = createHttpContext(req, res, params, Object.fromEntries(searchParams));
    return Promise.resolve(handler(ctx)).catch(err => {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

function createServer(cfg) {
  const server = cfg.protocol === 'https'
    ? https.createServer({ key: fs.readFileSync(cfg.keypath), cert: fs.readFileSync(cfg.certpath) }, onRequest)
    : http.createServer((req, res) => onRequest(req, res, cfg));
  attachWebSocketHandler(server);
  return server;
}

function startServer(cfg) {
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`🚀 Server running at http://${cfg.host}:${cfg.port}/`);
  });
}

init();
