
import OpenAI from 'openai';

import dotenv from 'dotenv';
dotenv.config();

// ─── Runtime config ─────────────────────────────────────────────────
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


/** Turn many possible chunk shapes into a plain token string */
function tokenFrom(chunk) {
  return (
    // OpenAI chat / assistants
    chunk?.choices?.[0]?.delta?.content ??
    chunk?.data?.[0]?.delta?.content ??
    // Anthropic Claude 3
    chunk?.delta ?? chunk?.content ??
    // Gemini Pro
    chunk?.candidates?.[0]?.content?.parts?.[0]?.text ??
    ''
  );
}

/** Non-blocking listener: fire onToken for each delta, return stream untouched */
async function _attachTokenListener(stream, onToken) {
  if (typeof onToken !== 'function') return stream;

  let fullText = '';
  for await (const chunk of stream) {
    const delta = tokenFrom(chunk);
    if (!delta) continue;
    fullText += delta;
    try {
      onToken?.(delta);
    } catch (err) {
      console.error('onToken callback error:', err);
    }
  }

  // once the SSE ends, return in non-streaming shape
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: fullText
        }
      }
    ]
  };
}


//there are more params available if you look at the functions

//we can use this as a foundation to generalize e.g. to claude or gemini or offline models (e.g. with an api that mimics openai's)

/**
 * Send a chat completion request.
 *
 * **Streaming usage:**
 * ```js
 * await createChatCompletion(
 *   { model: 'gpt-4o', messages, stream: true },
 *   token => console.log('delta:', token)
 * );
 * ```
 * The second argument is an *optional* callback that fires once per token when
 * `params.stream === true`. If you omit it, you still get streaming (OpenAI
 * bills at stream rates) but you won't see intermediate deltas.
 *
 * The Promise always resolves with the full aggregated message so existing
 * non‑streaming callers don’t need changes.
 *
 * @param {Object}   params                       – Same shape the SDK expects.
 * @param {string}   params.model                 – e.g. "gpt-4o".
 * @param {Array<{ role:string, content:string }>} params.messages – Chat log.
 * @param {number}  [params.temperature]
 * @param {number}  [params.max_tokens]
 * @param {(delta:string)=>void} [onToken]        – Optional per‑token handler.
 * @returns {Promise<{choices:[{message:{role:string,content:string}}]}>}
 */
export async function createChatCompletion(params, onToken) {
  // streaming path
  if (onToken || params.stream) {
    const stream = await openai.chat.completions.create({
      ...params,
      stream: true,
    });
    return await _attachTokenListener(stream, onToken);
  }

  // non-streaming path
  return openai.chat.completions.create(params);
}



/** Extract every text.value from a thread.message.delta chunk */
function* _tokensFromThreadDelta(evt) {
  if (evt.event !== 'thread.message.delta') return;
  const parts = evt?.data?.delta?.content ?? [];
  for (const part of parts) {
    const t = part?.text?.value;
    if (t) yield t;
  }
}

/**
 * Wrap the SDK’s event stream so:
 *   • caller sees *tokens* (plain strings) instead of event objects
 *   • optional onToken side-effect fires per token
 */
function _threadTokenStream(stream, onToken) {
  if (typeof onToken !== 'function') return stream;   // nothing to do

  // Save original async iterator
  const origAsyncIter = stream[Symbol.asyncIterator].bind(stream);

  // Replace with a proxy iterator
  stream[Symbol.asyncIterator] = function () {
    const iter = origAsyncIter();
    return {
      async next() {
        const { value, done } = await iter.next();
        if (!done) {
          for (const tok of _tokensFromThreadDelta(value)) onToken(tok);
        }
        return { value, done };          // forward the *same* event object
      },
      return(v) { return iter.return?.(v) ?? Promise.resolve({ done: true }); },
      throw(err) { return iter.throw?.(err) ?? Promise.reject(err); },
      [Symbol.asyncIterator]() { return this; }
    };
  };
  return stream;                         // caller gets untouched event stream
}


/**
 * Kick off a new run inside an existing thread (Assistants + tools).
 *
 * **Streaming:** set `params.stream = true` *and* supply `onToken` to receive
 * each incremental token. The call resolves with the aggregated text so you
 * can await it just like a normal run.
 *
 * @param {string}                 threadId                            OpenAI thread ID to execute within.
 * @param {Object}                 params                              Run-creation payload accepted by the SDK.
 * @param {string}                 params.assistant_id                 ID of the assistant to invoke.
 * @param {string}       [params.instructions]                        Extra instructions for this run.
 * @param {Array<Object>} [params.tools]                              Tool manifest to expose.
 * @param {'none'|'auto'|{type:'function',name:string}} [params.tool_choice='none']  How the assistant should call tools.
 * @param {(delta:string)=>void} [onToken]                            Optional callback fired per token **only** when `stream:true`.
 * @returns {Promise<{text:string}>|Promise<Object>}                  If streaming, resolves with `{ text }`; otherwise the native Run object.
 *
 * @example
 * const run = await createThreadRun(
 *   threadId,
 *   {
 *     assistant_id,
 *     instructions: 'Summarise the conversation',
 *     tool_choice: 'auto'
 *   },
 *   token => ui.append(token)
 * );
 */
export async function createThreadRun(threadId, params, onToken) {
  // streaming path
  if (onToken || params.stream) {
    const stream = await openai.beta.threads.runs.create(threadId, {
      ...params,
      stream: true,
    });
    return _threadTokenStream(stream, onToken);
  }

  // non-streaming path
  return openai.beta.threads.runs.create(threadId, params);
}


/**
 * Create a new thread.
 *
 * @returns {Promise<Object>} - The created thread object, with `id`
 */
export async function createThread() {
  return openai.beta.threads.create();
}


/**
 * List messages in a thread.
 *
 * @param {string} threadId - OpenAI thread ID
 * @param {Object} params
 * @param {number} params.limit        - Number of messages to fetch
 * @param {string} params.order        - 'asc' or 'desc'
 * @param {string} [params.cursor]     - Cursor for pagination
 * @returns {Promise<Object>}        - { data: Array<message>, next_cursor }
 */
export async function listThreadMessages(threadId, params) {
  return openai.beta.threads.messages.list(threadId, params);
}

/**
 * Delete a single message from a thread.
 *
 * @param {string} threadId  - OpenAI thread ID
 * @param {string} messageId - ID of the message to delete
 * @returns {Promise<Object>} - Deletion confirmation
 */
export async function deleteThreadMessage(threadId, messageId) {
  return openai.beta.threads.messages.del(threadId, messageId);
}

/**
 * Post a new message into a thread.
 *
 * @param {string} threadId - OpenAI thread ID
 * @param {Object} params   - { role: string, content: Array<{type, text}> }
 * @returns {Promise<Object>} - The created message object
 */
export async function createThreadMessage(threadId, params) {
  return openai.beta.threads.messages.create(threadId, params);
}

/**
 * Retrieve the current status of a run.
 *
 * @param {string} threadId - OpenAI thread ID
 * @param {string} runId    - Run ID
 * @returns {Promise<Object>} - The run object with updated status/usage
 */
export async function retrieveThreadRun(threadId, runId) {
  return openai.beta.threads.runs.retrieve(threadId, runId);
}

/**
 * List past runs in a thread.
 *
 * @param {string} threadId - OpenAI thread ID
 * @param {Object} params
 * @param {number} params.limit    - Number of runs to fetch
 * @param {string} [params.cursor] - Cursor for pagination
 * @returns {Promise<Object>}    - { data: Array<run>, next_cursor }
 */
export async function listThreadRuns(threadId, params) {
  return openai.beta.threads.runs.list(threadId, params);
}

/**
 * Submit tool outputs back into a run that is awaiting them.
 *
 * @param {string} threadId  - OpenAI thread ID
 * @param {string} runId     - Run ID awaiting tool outputs
 * @param {Object} params    - { tool_outputs: Array<{tool_call_id, output}> }
 * @returns {Promise<Object>} - Submission confirmation
 */
export async function submitRunToolOutputs(threadId, runId, params) {
  return openai.beta.threads.runs.submitToolOutputs(threadId, runId, params);
}

/**
 * Create or update an assistant.
 *
 * @param {Object} params
 * @param {string} params.name          - Assistant name
 * @param {string} params.instructions  - System prompt/instructions
 * @param {Array}  params.tools         - Tools/function schemas
 * @param {string} params.model         - Base model ID (e.g. BASE_MODEL)
 * @returns {Promise<Object>}           - The assistant object with `id`
 */
export async function createAssistant(params) {
  return openai.beta.assistants.create(params);
}

/**
 * Delete an existing assistant.
 *
 * @param {string} assistantId - The assistant ID to delete
 * @returns {Promise<Object>}  - Deletion confirmation
 */
export async function deleteAssistant(assistantId) {
  return openai.beta.assistants.del(assistantId);
}

// Track user‐requested cancels
const cancelFlags = new Map();


/** Throw if someone asked to cancel this thread */
export function checkCancel(threadId) {
  if (cancelFlags.get(threadId)) {
    cancelFlags.delete(threadId);
    throw new Error('Cancelled by user');
  }
}


/**
* Request cancellation of a specific run in a thread.
* @param {string} threadId - OpenAI thread ID
* @param {string} runId    - Run ID to cancel
* @returns {Promise<Object>} - The canceled run object
*/
export async function requestCancel(threadId, runId) {
  cancelFlags.set(threadId, true);
  return openai.beta.threads.runs.cancel(threadId, runId);
}



/**
 * Upload a file to OpenAI’s file store for Assistants.
 *
 * @param {string} filePath – local path to a file
 * @returns {Promise<{id:string, filename:string, bytes:number, created_at:number}>}
 */
export async function uploadFile(filePath) {
  console.log(`[uploadFile] called with filePath=${filePath}`);
  try {
    const abs = path.resolve(filePath);
    const stream = fs.createReadStream(abs);
    const result = await openai.files.create({
      file: stream,
      purpose: 'assistants'
    });
    console.log(
      `[uploadFile] success: id=${result.id}, filename=${result.filename}, bytes=${result.bytes}`
    );
    return result;
  } catch (err) {
    console.error(`[uploadFile] error uploading '${filePath}':`, err);
    throw err;
  }
}

/**
 * Convert a local file to a Data-URL (<20 MB) for vision chat completions.
 *
 * @param {string} filePath – local path
 * @returns {Promise<string>}  e.g. "data:image/png;base64,iVBORw0KGgo…"
 */
export async function localFileToDataURL(filePath) {
  console.log(`[localFileToDataURL] called with filePath=${filePath}`);
  try {
    const abs = path.resolve(filePath);
    const buf = await fs.promises.readFile(abs);
    const ext = path.extname(abs).slice(1);
    const mime = mimeFromExt(ext);
    const b64  = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    console.log(
      `[localFileToDataURL] success: length=${dataUrl.length} chars`
    );
    return dataUrl;
  } catch (err) {
    console.error(
      `[localFileToDataURL] error reading '${filePath}':`,
      err
    );
    throw err;
  }
}

/**
 * Upload a data-URL string to the Assistants file store and return the file object.
 *
 * @param {string} dataUrl    – Full data-URL from the client
 * @param {string} [filename] – Optional filename (defaults to "upload_<timestamp>.<ext>")
 * @returns {Promise<{id:string, filename:string, bytes:number, created_at:number}>}
 */
export async function uploadDataURL(dataUrl, filename) {
  console.log(
    `[uploadDataURL] called with filename=${filename || '<auto>'}, dataUrl length=${dataUrl.length}`
  );
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    const [, mime, b64] = match;

    const extFromMime = mime.split('/')[1] || 'bin';
    const safeName =
      filename ||
      `upload_${Date.now()}.${extFromMime}`;

    const buf = Buffer.from(b64, 'base64');
    const result = await openai.files.create({
      file: {
        value: buf,
        options: {
          filename: safeName,
          contentType: mime
        }
      },
      purpose: 'assistants'
    });
    console.log(
      `[uploadDataURL] success: id=${result.id}, filename=${result.filename}, bytes=${result.bytes}`
    );
    return result;
  } catch (err) {
    console.error(`[uploadDataURL] error uploading data URL:`, err);
    throw err;
  }
}

/**
 * Permanently delete a file from OpenAI’s file store.
 *
 * @param {string} fileId – e.g. "file_abc123"
 * @returns {Promise<{id:string, object:'file', deleted:boolean}>}
 */
export async function deleteFile(fileId) {
  console.log(`[deleteFile] called with fileId=${fileId}`);
  try {
    const confirmation = await openai.files.del(fileId);
    console.log(
      `[deleteFile] success: id=${confirmation.id}, deleted=${confirmation.deleted}`
    );
    return confirmation;
  } catch (err) {
    console.error(`[deleteFile] error deleting fileId='${fileId}':`, err);
    throw err;
  }
}

/**
 * Simple extension → MIME lookup (covers images, documents, spreadsheets, etc.)
 */
function mimeFromExt(ext) {
  const m = {
    // Images
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    webp: 'image/webp',
    bmp:  'image/bmp',
    tiff: 'image/tiff',
    tif:  'image/tiff',

    // Documents
    pdf:  'application/pdf',
    txt:  'text/plain',
    rtf:  'application/rtf',
    html: 'text/html',
    md:   'text/markdown',

    // Spreadsheets
    csv:  'text/csv',
    xls:  'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    // Presentations
    ppt:  'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // Word processing
    doc:  'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

    // Archives
    zip:  'application/zip',
    tar:  'application/x-tar',
    '7z': 'application/x-7z-compressed',
    gz:   'application/gzip',
    rar:  'application/vnd.rar',

    // Data formats
    json: 'application/json',
    xml:  'application/xml',
    yaml: 'application/x-yaml',
    yml:  'application/x-yaml'
  };

  return m[ext.toLowerCase()] || 'application/octet-stream';
}
