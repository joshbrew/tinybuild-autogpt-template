// /gpt_dev/server.js
import * as http  from 'http';
import * as https from 'https';
import * as fs    from 'fs';
import * as path  from 'path';
import * as fsp   from 'fs/promises';

import { getEnvVar } from './serverUtil.js';
import { SAVED_DIR } from './openaiUtils.js'
import { apiRoutes } from './openaiRoutes.js';


// Ensure the saved folder exists & log existing threads on startup
async function init() {
  await fsp.mkdir(SAVED_DIR, { recursive: true });
  startServer(serverConfig);
}

const serverConfig = {
  protocol:  'http',
  host:      getEnvVar('HOST', 'localhost'),
  port:      Number(getEnvVar('PORT', '3000')),
  startpage: 'index.html'
};

async function onRequest(req, res, cfg) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Route dispatch
  const { url, method } = req;
  let handler;

  // 1) exact match
  if (apiRoutes[url] && apiRoutes[url][method]) {
    handler = apiRoutes[url][method];
  } else {
    
    // 2) parameterized match (e.g. /api/threads/:thread_id/messages/:message_id)
    for (const routeKey of Object.keys(apiRoutes)) {
      // skip non-param routes
      if (!routeKey.includes('/:')) continue;

      // build a RegExp out of the routeKey
      //   /api/threads/:thread_id/messages/:message_id
      // → ^/api/threads/([^/]+)(?:/messages/([^/]+))?/?$
      const parts = routeKey.split('/').filter(s => s.length);
      const paramNames = [];
      const pattern = parts
        .map(p => {
          if (p.startsWith(':')) {
            paramNames.push(p.slice(1));
            return '([^/]+)';
          } else {
            // escape literal
            return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          }
        })
        .join('/');
      const regex = new RegExp(`^/${pattern}/?$`);

      const match = url.match(regex);
      if (match) {
        const methods = apiRoutes[routeKey];
        if (methods[method]) {
          // pull out each captured group into req.params
          req.params = paramNames.reduce((acc, name, i) => {
            acc[name] = decodeURIComponent(match[i + 1]);
            return acc;
          }, {});
          handler = methods[method];
          break;
        }
      }
    }

  }

  if (handler) {
    return Promise.resolve(handler(req, res, { savedDir: SAVED_DIR }))
      .catch(err => {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      });
  }

  // Static file fallback
  let urlPath = url || '/';
  if (urlPath === '/' || urlPath === '') urlPath = '/' + cfg.startpage;
  if(urlPath === '/gptdev') urlPath = '/gpt_dev/gpt_dev.html';
  const filePath = path.join(process.cwd(), urlPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Internal Server Error');
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimes = {
        '.html':'text/html',
        '.js':  'application/javascript',
        '.css': 'text/css',
        '.json':'application/json'
      };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
      return res.end(content);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

function createServer(cfg) {
  if (cfg.protocol === 'https') {
    const opts = { key: fs.readFileSync(cfg.keypath), cert: fs.readFileSync(cfg.certpath) };
    return https.createServer(opts, (req, res) => onRequest(req, res, cfg));
  }
  return http.createServer((req, res) => onRequest(req, res, cfg));
}

function startServer(cfg) {
  const server = createServer(cfg);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`🚀 Server running at ${cfg.protocol}://${cfg.host}:${cfg.port}/`);
    console.log(`💬 Find the live dev chat server at ${cfg.protocol}://${cfg.host}:${cfg.port}/gptdev \n or at your content server ${cfg.protocol}://${cfg.host}:PORT/gptdev`);
  });
}

init();
