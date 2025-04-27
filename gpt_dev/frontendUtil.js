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
function apiRequest(path, method = 'GET', body = null, signal = null) {
  return USE_WS
    ? wsRequest(path, method, body, signal)
    : httpRequest(path, method, body, signal);
}

// ——— Threads ———
export async function fetchThreads() {
  const res = await fetch(`${API_BASE}/api/threads`);
  if (!res.ok) throw new Error(`Error fetching threads: ${res.statusText}`);
  return res.json();
}

export async function fetchThreadById(id) {
  const res = await fetch(`${API_BASE}/api/threads/${id}`);
  if (!res.ok) throw new Error(`Error fetching thread ${id}: ${res.statusText}`);
  return res.json();
}

export async function deleteThreadById(id) {
  const res = await fetch(`${API_BASE}/api/threads/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Error deleting thread ${id}: ${res.statusText}`);
  return res.json();
}

// ——— Messaging (always via /api/prompt) ———
export async function sendPrompt({ prompt, threadId, title } = {}, signal) {
  const body = { prompt };
  if (threadId) body.threadId = threadId;
  if (title)    body.title    = title;

  const res = await fetch(`${API_BASE}/api/prompt`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    // try to surface a JSON error
    let err;
    try { err = await res.json(); }
    catch { throw new Error(res.statusText); }
    throw new Error(err.errorMessage || err.error || res.statusText);
  }

  return res.json();
}


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
