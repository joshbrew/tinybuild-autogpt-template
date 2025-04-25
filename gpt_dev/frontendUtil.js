/* ───────────── Choose network transport ───────────── */
const USE_WS   = false;                     // ← flip to false to use plain fetch
export const WS_URL   = 'ws://localhost:3000/ws';
export const API_BASE = 'http://localhost:3000';

/* ───────────── WebSocket plumbing (only used if USE_WS) ───────────── */
let ws, wsReady, nextReqId = 1;
const pending = new Map();

function openSocket() {
  if (ws) return wsReady;
  ws       = new WebSocket(WS_URL);
  wsReady  = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const { reqId, ok = true, payload, error } = msg;
    const p = pending.get(reqId);
    if (!p) return;
    clearTimeout(p.t);
    pending.delete(reqId);
    ok ? p.res(payload) : p.rej(new Error(error || 'WS RPC error'));
  };

  ws.onclose = () => {
    for (const { rej } of pending.values())
      rej(new Error('WebSocket closed unexpectedly'));
    pending.clear();
    ws = wsReady = null;
  };

  return wsReady;
}

function wsRequest(path, method = 'GET', body = null) {
  return openSocket().then(() => {
    const reqId = nextReqId++;
    const t = setTimeout(() => {
      if (pending.has(reqId)) {
        pending.get(reqId).rej(new Error('WS RPC timeout'));
        pending.delete(reqId);
      }
    }, 15_000);

    ws.send(JSON.stringify({ reqId, path, method, body }));
    return new Promise((res, rej) => pending.set(reqId, { res, rej, t }));
  });
}

/* ───────────── fetch plumbing (only used if !USE_WS) ───────────── */
async function httpRequest(path, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  // DELETEs return 204; guard against empty body
  return res.status === 204 ? null : res.json();
}

/* ───────────── generic wrapper ───────────── */
function apiRequest(path, method = 'GET', body = null) {
  return USE_WS ? wsRequest(path, method, body)
                : httpRequest(path, method, body);
}

/* ───────────── Public helpers (unchanged call-sites) ───────────── */
export const fetchThreads = () =>
  apiRequest('/api/threads', 'GET');

export const fetchThreadById = id =>
  apiRequest(`/api/threads/${encodeURIComponent(id)}`, 'GET');

export const deleteThreadById = id =>
  apiRequest(`/api/threads/${encodeURIComponent(id)}`, 'DELETE');

export const sendPrompt = payload =>
  apiRequest('/api/prompt', 'POST', payload);

export const editMessage = (threadId, msgId, payload) =>
  apiRequest(
    `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(msgId)}`,
    'POST',
    payload
  );

export const deleteMessageById = (threadId, msgId) =>
  apiRequest(
    `/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(msgId)}`,
    'DELETE'
  );

export const fetchFilesTree = () =>
  apiRequest('/api/files', 'GET');
// ───────────── capture console (limit to last 100 entries) ─────────────
