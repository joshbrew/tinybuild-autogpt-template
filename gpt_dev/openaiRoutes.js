// /gpt_dev/openaiRoutes.js
import path   from 'path';
import * as fsp from 'fs/promises';
import { getRequestBody, setHeaders } from './serverUtil.js';

import {
  handlePrompt,
  runToolCalls,
  loadConversation,
  saveConversation,
  openai,
  SAVED_DIR,
} from './openaiUtils.js';



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
      try {
        const body = JSON.parse(await getRequestBody(req));
        const {
          logs,
          result,
          threadId,
          openaiThreadId,
          userMessageId,
          assistantMessageId
        } = await handlePrompt(body, savedDir);
        
        setHeaders(res, 200, 'application/json');
        res.end(JSON.stringify({
          logs,
          result,
          threadId,
          openaiThreadId,
          userMessageId,
          assistantMessageId
        }));

      } catch (err) {
        console.error('[openaiRoutes] /api/prompt error:', err);
        const code = err.message === 'Missing prompt' ? 400 : 500;
        setHeaders(res, code, 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  }


};
