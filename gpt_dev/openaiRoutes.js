// ./gpt_dev/openaiRoutes.js
import path from 'path';
import * as fsp from 'fs/promises';
import {
  openai
} from './openaiClient.js'

import {
  SAVED_DIR
} from './openaiConfig.js'

import {
  cancelRun,
  handlePrompt,
  loadConversation,
  saveConversation,
} from './openaiUtils.js';

import {
  pendingConsoleHistory, 
  resetProject, 
  makeFileWalker
} from './serverUtil.js'

// --- Handlers ---
async function listThreads(ctx) {
  const files = (await fsp.readdir(SAVED_DIR))
    .filter(f => f.endsWith('.txt'))
    .map(f => f.slice(0, -4));

  const threads = await Promise.all(
    files.map(async id => {
      const convo = await loadConversation(path.join(SAVED_DIR, id + '.txt'));
      return { id, title: convo.title || id, openaiThreadId: convo.openaiThreadId };
    })
  );

  await ctx.json(200, threads);
}

async function getThreadInfo(ctx) {
  const { id } = ctx.params;
  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${id}.txt`));
    await ctx.json(200, {
      id,
      title: convo.title,
      openaiThreadId: convo.openaiThreadId,
      messages: convo.messages
    });
  } catch {
    await ctx.json(404, { error: 'Thread not found' });
  }
}

async function renameThread(ctx) {
  const { id, title } = await ctx.body();
  if (!title || typeof title !== 'string') return ctx.json(400, { error: 'Missing or invalid title' });

  const filePath = path.join(SAVED_DIR, `${id}.txt`);
  let convo;
  try {
    convo = await loadConversation(filePath);
  } catch {
    convo = { messages: [], openaiThreadId: null, title: '' };
  }

  convo.title = title;
  await saveConversation(filePath, convo);

  if (convo.openaiThreadId) {
    await openai.beta.threads.update(convo.openaiThreadId, { metadata: { title } });
  }

  await ctx.json(200, { id, title });
}

// Delete both local file and remote thread
async function deleteThread(ctx) {
  const { id } = ctx.params;
  const filePath = path.join(SAVED_DIR, `${id}.txt`);
  let convo;

  try {
    convo = await loadConversation(filePath);
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }

  if (convo.openaiThreadId) {
    try {
      await openai.beta.threads.del(convo.openaiThreadId);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  await fsp.unlink(filePath).catch(() => {});
  await ctx.json(200, { success: true });
}

// Remote thread management
async function retrieveRemoteThread(ctx) {
  const { thread_id } = ctx.params;
  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
    if (!convo.openaiThreadId) {
      return ctx.json(404, { error: 'No OpenAI thread mapped' });
    }
    const thread = await openai.beta.threads.retrieve(convo.openaiThreadId);
    await ctx.json(200, thread);
  } catch (err) {
    await ctx.json(500, { error: err.message });
  }
}

async function updateRemoteThread(ctx) {
  const { thread_id } = ctx.params;
  const { metadata, tool_resources } = await ctx.body();

  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
    if (!convo.openaiThreadId) {
      return ctx.json(404, { error: 'No OpenAI thread mapped' });
    }
    const updated = await openai.beta.threads.update(convo.openaiThreadId, { metadata, tool_resources });
    await ctx.json(200, updated);
  } catch (err) {
    await ctx.json(500, { error: err.message });
  }
}

async function listMessages(ctx) {
  const { thread_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) return ctx.json(404, { error: 'No OpenAI thread mapped' });

  const q = ctx.query;
  const list = await openai.beta.threads.messages.list(convo.openaiThreadId, {
    limit: Number(q.limit || 20),
    order: q.order || 'desc',
    after: q.after,
    before: q.before
  });

  await ctx.json(200, list);
}

async function postMessage(ctx) {
  const { thread_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) return ctx.json(404, { error: 'No OpenAI thread mapped' });

  const body = ctx.body;
  const content = (body.content || []).map(c => ({ type: c.type || 'text', text: c.text }));
  const msg = await openai.beta.threads.messages.create(convo.openaiThreadId, {
    role: body.role,
    content,
    attachments: body.attachments,
    metadata: body.metadata
  });

  convo.messages.push(msg);
  await saveConversation(path.join(SAVED_DIR, `${thread_id}.txt`), convo);
  await ctx.json(201, msg);
}

async function getMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) return ctx.json(404, { error: 'No OpenAI thread mapped' });

  const msg = await openai.beta.threads.messages.retrieve(convo.openaiThreadId, message_id);
  await ctx.json(200, msg);
}

async function updateMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const filePath = path.join(SAVED_DIR, `${thread_id}.txt`);

  // Load or 404
  let convo;
  try {
    convo = await loadConversation(filePath);
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  // Parse body
  const body = await ctx.body();

  // 1) Build the new content array
  let newContentArray = [];
  if (typeof body.content === 'string') {
    newContentArray = [{ type: 'text', text: body.content }];
  } else if (Array.isArray(body.content)) {
    newContentArray = body.content.map(c => ({
      type: c.type || 'text',
      text: c.text
    }));
  }
  // (else leave as empty [])

  // 2) Update local convo.messages
  convo.messages = convo.messages.map(m =>
    m.id === message_id
      ? { ...m, content: newContentArray }
      : m
  );

  // 3) Persist to disk
  await saveConversation(filePath, convo);

  // 4) Push metadata-only updates upstream, if provided
  if (body.metadata) {
    try {
      await openai
        .beta.threads
        .messages
        .update(convo.openaiThreadId, message_id, {
          metadata: body.metadata
        });
    } catch (err) {
      console.warn('Failed to update metadata:', err);
    }
  }

  // 5) Return the updated message
  const updated = convo.messages.find(m => m.id === message_id);
  return ctx.json(200, updated);
}

async function deleteMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) return ctx.json(404, { error: 'No OpenAI thread mapped' });

  const del = await openai.beta.threads.messages.del(convo.openaiThreadId, message_id);
  convo.messages = convo.messages.filter(m => m.id !== message_id);
  await saveConversation(path.join(SAVED_DIR, `${thread_id}.txt`), convo);
  await ctx.json(200, del);
}

async function listFiles(ctx) {
  const params = {
    folder: ctx.query.folder || '.',
    recursive: ctx.query.recursive !== 'false',
    skip_node_modules: ctx.query.skip_node_modules !== 'false',
    deep_node_modules: ctx.query.deep_node_modules === 'true'
  };
  const walker = makeFileWalker({
    recursive:         params.recursive,
    skip_node_modules: params.skip_node_modules !== false,
    deep_node_modules: params.deep_node_modules === true
  });

  const result = JSON.stringify(await walker(path.join(process.cwd(),params.folder||'.')));

  await ctx.text(200, result);
}

async function handlePromptRoute(ctx) {
  // parse the incoming body
  const body = await ctx.body();

  // call into handlePrompt
  const res = await handlePrompt(body, SAVED_DIR);

  // if handlePrompt decided there was an error, return that as a 400 (or 500 if you prefer)
  if (res.error) {
    return ctx.json(400, { error: res.errorMessage });
  }

  // otherwise unpack and return the normal fields
  const {
    logs,
    result,
    threadId,
    openaiThreadId,
    userMessageId,
    assistantMessageId
  } = res;

  return ctx.json(200, {
    logs,
    result,
    threadId,
    openaiThreadId,
    userMessageId,
    assistantMessageId
  });
}

async function postConsoleHistory(ctx) {
  const { id, history } = await ctx.body();

  if (!id || !Array.isArray(history)) {
    return ctx.json(400, { error: 'Missing id or history[]' });
  }
  if (!pendingConsoleHistory.has(id)) {
    return ctx.json(404, { error: 'id not pending' });
  }

  // call the awaiting Promise in runToolCalls then clear it
  pendingConsoleHistory.get(id)(history);
  pendingConsoleHistory.delete(id);

  // 204 = no content
  ctx.res.writeHead(204);
  ctx.res.end();
}

// --- Route definitions and matchers ---
export const routesConfig = {
  '/api/threads': { GET: listThreads },
  '/api/threads/:id': { GET: getThreadInfo, DELETE: deleteThread },
  '/api/threads/:id/title': { POST: renameThread },
  '/api/threads/:thread_id': { GET: retrieveRemoteThread, POST: updateRemoteThread, DELETE: deleteThread },
  '/api/threads/:thread_id/messages': { GET: listMessages, POST: postMessage },
  '/api/threads/:thread_id/messages/:message_id': { GET: getMessage, POST: updateMessage, DELETE: deleteMessage },
  '/api/threads/:thread_id/cancel': { POST: cancelRun },
  '/api/files': { GET: listFiles },
  '/api/prompt': { POST: handlePromptRoute },
  '/api/reset_project': { POST: resetProject },
  '/api/console_history': { POST: postConsoleHistory }
};
