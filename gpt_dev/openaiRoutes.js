// ./gpt_dev/openaiRoutes.js
import path from 'path';
import * as fsp from 'fs/promises';
import { openai, requestCancel } from './openaiClient.js';
import { SAVED_DIR } from './clientConfig.js';
import {
  cancelActiveRuns,
  handlePrompt,
  loadConversation,
  saveConversation,
} from './openaiUtils.js';
import {
  pendingConsoleHistory,
  resetProject,
  makeFileWalker
} from './serverUtil.js';

// --- Handlers ---
export async function listThreads(ctx) {
  const files = (await fsp.readdir(SAVED_DIR))
    .filter(f => f.endsWith('.txt'))
    .map(f => f.slice(0, -4));

  const threads = await Promise.all(
    files.map(async id => {
      const convo = await loadConversation(path.join(SAVED_DIR, id + '.txt'));
      return {
        id,
        title: convo.title || id,
        openaiThreadId: convo.openaiThreadId
      };
    })
  );

  return ctx.json(200, threads);
}

export async function getThreadInfo(ctx) {
  const { id } = ctx.params;
  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${id}.txt`));
    return ctx.json(200, {
      id,
      title: convo.title,
      openaiThreadId: convo.openaiThreadId,
      messages: convo.messages
    });
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
}

export async function renameThread(ctx) {
  const { id } = ctx.params;
  const { title } = ctx.request.body;
  if (!title || typeof title !== 'string') {
    return ctx.json(400, { error: 'Missing or invalid title' });
  }

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
    await openai.beta.threads.update(convo.openaiThreadId, {
      metadata: { title }
    });
  }

  return ctx.json(200, { id, title });
}

export async function deleteThread(ctx) {
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
  return ctx.json(200, { success: true });
}

export async function retrieveRemoteThread(ctx) {
  const { thread_id } = ctx.params;
  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
    if (!convo.openaiThreadId) {
      return ctx.json(404, { error: 'No OpenAI thread mapped' });
    }
    const thread = await openai.beta.threads.retrieve(convo.openaiThreadId);
    return ctx.json(200, thread);
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

export async function updateRemoteThread(ctx) {
  const { thread_id } = ctx.params;
  const { metadata, tool_resources } = ctx.request.body;

  try {
    const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
    if (!convo.openaiThreadId) {
      return ctx.json(404, { error: 'No OpenAI thread mapped' });
    }
    const updated = await openai.beta.threads.update(convo.openaiThreadId, {
      metadata,
      tool_resources
    });
    return ctx.json(200, updated);
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

export async function listMessages(ctx) {
  const { thread_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  const q = ctx.request.query;
  const list = await openai.beta.threads.messages.list(convo.openaiThreadId, {
    limit: Number(q.limit || 20),
    order: q.order || 'desc',
    after: q.after,
    before: q.before
  });

  return ctx.json(200, list);
}

export async function postMessage(ctx) {
  const { thread_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  const { role, content, attachments, metadata } = ctx.request.body;
  const formatted = (content || []).map(c => ({
    type: c.type || 'text',
    text: c.text
  }));
  const msg = await openai.beta.threads.messages.create(convo.openaiThreadId, {
    role,
    content: formatted,
    attachments,
    metadata
  });

  convo.messages.push(msg);
  await saveConversation(path.join(SAVED_DIR, `${thread_id}.txt`), convo);
  return ctx.json(201, msg);
}

export async function getMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  const msg = await openai.beta.threads.messages.retrieve(
    convo.openaiThreadId,
    message_id
  );
  return ctx.json(200, msg);
}

export async function updateMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const filePath = path.join(SAVED_DIR, `${thread_id}.txt`);

  let convo;
  try {
    convo = await loadConversation(filePath);
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  const body = ctx.request.body;
  let newContentArray = [];
  if (typeof body.content === 'string') {
    newContentArray = [{ type: 'text', text: body.content }];
  } else if (Array.isArray(body.content)) {
    newContentArray = body.content.map(c => ({
      type: c.type || 'text',
      text: c.text
    }));
  }

  convo.messages = convo.messages.map(m =>
    m.id === message_id ? { ...m, content: newContentArray } : m
  );
  await saveConversation(filePath, convo);

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

  const updated = convo.messages.find(m => m.id === message_id);
  return ctx.json(200, updated);
}

export async function deleteMessage(ctx) {
  const { thread_id, message_id } = ctx.params;
  const convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  const del = await openai.beta.threads.messages.del(
    convo.openaiThreadId,
    message_id
  );
  convo.messages = convo.messages.filter(m => m.id !== message_id);
  await saveConversation(path.join(SAVED_DIR, `${thread_id}.txt`), convo);
  return ctx.json(200, del);
}

export async function listFiles(ctx) {
  const params = {
    folder:               ctx.request.query.folder || '.',
    recursive:            ctx.request.query.recursive !== 'false',
    skip_node_modules:    ctx.request.query.skip_node_modules !== 'false',
    deep_node_modules:    ctx.request.query.deep_node_modules === 'true'
  };
  const walker = makeFileWalker({
    recursive:         params.recursive,
    skip_node_modules: params.skip_node_modules,
    deep_node_modules: params.deep_node_modules
  });

  const result = await walker(
    path.join(process.cwd(), params.folder)
  );
  return ctx.text(200, JSON.stringify(result));
}

export async function handlePromptRoute(ctx) {
  const body = ctx.request.body;
  const res = await handlePrompt(body, SAVED_DIR);

  if (res.error) {
    return ctx.json(400, { error: res.errorMessage });
  }

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

export async function postConsoleHistory(ctx) {
  const { id, history } = ctx.request.body;
  if (!id || !Array.isArray(history)) {
    return ctx.json(400, { error: 'Missing id or history[]' });
  }
  if (!pendingConsoleHistory.has(id)) {
    return ctx.json(404, { error: 'id not pending' });
  }

  pendingConsoleHistory.get(id)(history);
  pendingConsoleHistory.delete(id);

  // 204 = no content
  res.writeHead(204);
  return res.end();
}

export async function cancelRun(ctx) {
  const { thread_id } = ctx.params;
  let convo;
  try {
    convo = await loadConversation(
      path.join(SAVED_DIR, `${thread_id}.txt`)
    );
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  requestCancel(convo.openaiThreadId);
  return ctx.json(200, { canceled: true });
}

// --- Route definitions ---
export const routesConfig = {
  '/api/threads':                     { GET: listThreads },
  '/api/threads/:id':                 { GET: getThreadInfo, DELETE: deleteThread },
  '/api/threads/:id/title':           { POST: renameThread },
  '/api/threads/:thread_id':          { GET: retrieveRemoteThread, POST: updateRemoteThread, DELETE: deleteThread },
  '/api/threads/:thread_id/messages': { GET: listMessages, POST: postMessage },
  '/api/threads/:thread_id/messages/:message_id': {
    GET: getMessage,
    POST: updateMessage,
    DELETE: deleteMessage
  },
  '/api/threads/:thread_id/cancel':   { POST: cancelRun },
  '/api/files':                       { GET: listFiles },
  '/api/prompt':                      { POST: handlePromptRoute },
  '/api/reset_project':               { POST: resetProject },
  '/api/console_history':             { POST: postConsoleHistory }
};
