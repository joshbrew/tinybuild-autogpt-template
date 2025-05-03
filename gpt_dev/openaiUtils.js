// ./gpt_dev/openaiUtils.js

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs'
import http from 'http';
import https from 'https';
import { exec } from 'child_process';
import {
  flattenContent, 
  sseChannel, 
  pendingConsoleHistory, makeFileWalker,
  rateLimit, lockThread, unlockThread, checkCancel, requestCancel,
  logError, logInfo, logSuccess, logWarn
} from './serverUtil.js'

import{ DEFAULT_SYSTEM_PROMPT } from './openaiSystemPrompt.js'
import { functionSchemas, tools } from './openaiToolCalls.js';


import {
  BASE_MODEL, SUMM_MODEL, SMART_MODEL,
  MODEL_LIMITS, SUMM_LIMIT,
  TOKEN_LIMIT_PER_MIN, PRUNE_AT, KEEP_N_LIVE,
  RUN_SAFE_MULT, COMP_BUF, HARD_CAP, 
  ASSISTANT_FILE, SAVED_DIR, PRUNED_SUMMARY_TOKENS
} from './openaiConfig.js'

import { 
  openai, 
  listThreadMessages, listThreadRuns, 
  createChatCompletion, 
  createThread, createThreadRun, 
  createThreadMessage, deleteThreadMessage,
  submitRunToolOutputs, 
  createAssistant, deleteAssistant,
  retrieveThreadRun
} from './openaiClient.js';

import dotenv from 'dotenv';
dotenv.config();


// ─── Tool‐calling runner, see function schemas in openaiToolCalls.js  ───────────────────────────────────────────────
export async function runToolCalls(toolCalls, threadId) {
  const fnLogs = [], follow = [];
  let selfPrompt = null;
  const root = process.cwd();
  const safe = (...p) => path.join(root, ...p);

  checkCancel(threadId);

  for (const tc of toolCalls) {
    const name = tc.function?.name ?? tc.name;
    const args = JSON.parse(tc.function?.arguments ?? tc.arguments);
    let result = '';

    switch (name) {

      case 'read_file': {
        const fp = safe(args.folder, args.filename);
        let txt, st;
        try {
          txt = await fs.readFile(fp, 'utf-8');
          st  = await fs.stat(fp);
        } catch (err) {
          if (err.code === 'ENOENT') {
            // fallback to empty content (or signal error back to ChatGPT)
            result = JSON.stringify({
              content:    '',
              byteLength: 0,
              modifiedTime: null
            });
            break;
          }
          throw err;
        }
        result = JSON.stringify({
          content: txt,
          byteLength: st.size,
          modifiedTime: st.mtime.toISOString()
        });
        break;
      }
      
      case 'write_file': {
        const dir = safe(args.folder);
        await fs.mkdir(dir, { recursive:true });
        const fp = safe(args.folder, args.filename);
        let existing = '';
        try { existing = await fs.readFile(fp, 'utf-8'); } catch {}
        let out = args.content;
        if (args.replace_range) {
          out = existing.slice(0, args.replace_range.start)
              + args.content
              + existing.slice(args.replace_range.end);
        } else if (Number.isInteger(args.insert_at)) {
          const p = args.insert_at;
          out = existing.slice(0, p) + args.content + existing.slice(p);
        }
        await fs.writeFile(fp, out, 'utf-8');
        const st2 = await fs.stat(fp);
        result = JSON.stringify({ byteLength: st2.size });
        break;
      }

      case 'copy_file': {
        const src = safe(args.source);
        const dst = safe(args.destination);
        const root = process.cwd();
      
        // 1) Ensure neither path escapes the project root
        if (!src.startsWith(root + path.sep) || !dst.startsWith(root + path.sep)) {
          result = `Error: invalid path (outside project root)`;
          break;
        }
      
        try {
          // 2) Ensure the destination directory exists
          await fs.mkdir(path.dirname(dst), { recursive: true });
          // 3) Attempt the copy
          await fs.copyFile(src, dst);
          result = `Copied ${args.source} → ${args.destination}`;
        } catch (err) {
          // 4) Missing source file? handle gracefully
          if (err.code === 'ENOENT') {
            result = `Error copying "${args.source}": file not found`;
            break;
          }
          // 5) Otherwise re-throw
          throw err;
        }
        break;
      }

      case 'fetch_file': {
        const url = args.url;
        const dst = safe(args.destination);
        // ensure destination directory exists
        await fs.mkdir(path.dirname(dst), { recursive: true });
      
        let succeeded = false;
        try {
          await new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, res => {
              if (res.statusCode !== 200) {
                // reject on any non-200
                return reject(new Error(`HTTP ${res.statusCode}`));
              }
              const fileStream = fsSync.createWriteStream(dst);
              res.pipe(fileStream);
              fileStream.once('finish', () => fileStream.close(resolve));
            });
            req.once('error', err => {
              // clean up partial file
              fsSync.unlink(dst, () => {});
              reject(err);
            });
          });
          succeeded = true;
        } catch (err) {
          // gracefully capture the error
          result = `Error fetching "${url}": ${err.message}`;
        }
      
        if (succeeded) {
          result = `Fetched ${url} → ${args.destination}`;
        }
        break;
      }

      case 'list_directory': {
        const folder = args.folder || '.';
        const absPath = safe(folder);
      
        // guard against “no such directory”
        let items = [];
        try {
          const walker = makeFileWalker({
            recursive:         args.recursive,
            skip_node_modules: args.skip_node_modules !== false,
            deep_node_modules: args.deep_node_modules === true,
          });
          items = await walker(absPath);
        } catch (err) {
          if (err.code === 'ENOENT') {
            console.warn(`list_directory: directory not found at ${absPath}, returning []`);
            items = [];
          } else {
            throw err;
          }
        }
      
        result = JSON.stringify(items);
        break;
      }

      case 'move_file': {
        const src = safe(args.source);
        const dst = safe(args.destination);
        await fs.mkdir(path.dirname(dst), { recursive:true });
        await fs.rename(src, dst);
        result = `Moved ${args.source} → ${args.destination}`;
        break;
      }

      case 'remove_directory': {
        await fs.rm(safe(args.folder), {
          recursive: args.recursive !== false,
          force: true
        });
        result = `Removed directory ${args.folder}`;
        break;
      }

      case 'rename_file': {
        const dir = safe(args.folder);
        await fs.rename(
          path.join(dir, args.old_filename),
          path.join(dir, args.new_filename)
        );
        result = `Renamed ${args.old_filename} → ${args.new_filename}`;
        break;
      }

      case 'reset_project': {
        const msg = await resetProject();
        result = msg;
        break;
      }

      case 'run_shell': {
        console.log("Shell running: ", args.command);
        if(args.command === 'npm run build') {
          result = "Illegal command."
          break; 
        }
        result = await new Promise(resolve => {
          exec(args.command, { cwd: root, shell: true }, (err, stdout, stderr) => {
            resolve(JSON.stringify({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              code: err ? err.code : 0
            }));
          });
        });
        break;
      }

      case 'reprompt_self': {
        selfPrompt = args.new_prompt;
        console.log("Prompting self: ", selfPrompt);
        result = 'Scheduled self-prompt';
        break;
      }

      case 'smart_chat': {
        const { 
          messages, 
          temperature,
          max_completion_tokens 
        } = args;
        const resp = await createChatCompletion({
          model: SMART_MODEL,
          messages,
          //temperature,
          max_completion_tokens
        });
        const reply = resp.choices?.[0]?.message?.content ?? '';
        result = JSON.stringify({ reply });
        break;
      }

      case 'get_console_history': {
        // 1) create a request id and broadcast SSE
        const id = Math.random()*1000000000000000;
        sseChannel.broadcast(JSON.stringify({ type:'request_console_history', id }), 'console');
      
        // 2) wait for POST /api/console_history to resolve
        const history = await new Promise((resolve, reject) => {
          // keep resolver so the HTTP endpoint can call it
          pendingConsoleHistory.set(id, resolve);
          // 15-s timeout to avoid hanging forever
          setTimeout(() => {
            pendingConsoleHistory.delete(id);
            reject(new Error('console history timeout'));
          }, 15_000);
        });
      
        result = JSON.stringify(history);
        break;
      }

    }

    const replyTokens = estimateTokensFromString(result);
    await throttleByTokens(replyTokens);           // stay inside TPM
    addToThreadTally(
      threadId,
      [{ type: 'text', text: result }]             // mimics the message body
    );

    fnLogs.push({ type:'function_call', name, arguments:args });
    fnLogs.push({ type:'function_result', name, result });
    follow.push(
      { role:'assistant', tool_calls:[tc] },
      { role:'tool', tool_call_id:tc.id, name, content:result }
    );
  }

  fnLogs.forEach((l) => {
    if(l?.type === 'function_call') { 
      console.log("Assistant called", l.name);
    }
  });

  return { fnLogs, follow, selfPrompt };
}


// Map: OpenAI-thread-ID → running total of message-tokens *as last sent*
const threadTokenTally = new Map();

/** Call once whenever you add *any* message to the thread */
function addToThreadTally(threadId, content) {
  const txt = Array.isArray(content)
    ? content.map(c => typeof c.text === 'string' ? c.text : c.text.value).join('')
    : (typeof content === 'string' ? content : JSON.stringify(content));

  const t = estimateTokensFromString(txt);
  threadTokenTally.set(threadId, (threadTokenTally.get(threadId) || 0) + t);
}

// ─── Token-bucket state ───────────────────────────────
const tokenHistory = [];  // { ts: <ms-since-epoch>, tokens: <number> }

function cleanTokenHistory() {
  const cutoff = Date.now() - 60_000;
  while (tokenHistory.length && tokenHistory[0].ts < cutoff) {
    tokenHistory.shift();
  }
}

/**
 * Keep calling pruneThread with progressively smaller keepN until the
 * context plus `extra` is safely under HARD_CAP.
 */

async function shrinkContextIfNeeded(threadId, extra = 0) {
  let ctx = threadTokenTally.get(threadId) || 0;
  logInfo(`[shrink] ctx=${ctx}  extra=${extra}  hardCap=${HARD_CAP}`);

  // pass 1 – normal prune
  await pruneThread(threadId, KEEP_N_LIVE);
  ctx = threadTokenTally.get(threadId) || 0;
  logInfo(`[shrink] after keep ${KEEP_N_LIVE} ctx=${ctx}`);
  if (ctx + extra <= HARD_CAP) return;

  // pass 2 – keep last 5
  await pruneThread(threadId, 5);
  ctx = threadTokenTally.get(threadId) || 0;
  logInfo(`[shrink] after keep 5 ctx=${ctx}`);
  if (ctx + extra <= HARD_CAP) return;

  // pass 3 – keep last 2
  await pruneThread(threadId, 2);
  ctx = threadTokenTally.get(threadId) || 0;
  logInfo(`[shrink] after keep 2 ctx=${ctx}`);
}


/**
 * Summarise and collapse a thread so its token load stays below PRUNE_AT.
 * `keepN` lets the caller keep fewer live messages for aggressive shrinking.
 */
async function pruneThread(threadId, keepN = KEEP_N_LIVE) {
  
  function shouldPrune(threadId, extra = 0) {
    const ctx = threadTokenTally.get(threadId) || 0;
    return ctx + extra + COMP_BUF > HARD_CAP;
  }

  if(!shouldPrune(threadId)) return;
  
  const ctxTok = threadTokenTally.get(threadId) || 0;
  if (ctxTok < PRUNE_AT && keepN === KEEP_N_LIVE) {
    logInfo(`[pruneThread] ctx=${ctxTok} < PRUNE_AT (${PRUNE_AT}) – skip`);
    return;
  }
  logInfo(`[pruneThread] BEGIN  ctxTok=${ctxTok}  keepN=${keepN}`);

  /* 1) fetch full history (oldest→newest) */
  let cursor = null, all = [];
  do {
    await rateLimit();
    const res = await listThreadMessages(threadId, {
      limit: 100, order: 'asc', ...(cursor ? { cursor } : {})
    });
    all.push(...res.data);
    cursor = res.next_cursor;
  } while (cursor);

  /* 2) strip always-dropped roles that are *not* in the live tail */
  const tailStart = Math.max(0, all.length - keepN);
  const head      = all.slice(0, tailStart)
                       .filter(m => !ROLES_TO_DROP.includes(m.role));
  const liveTail  = all.slice(tailStart);   // keep tail verbatim

  if (head.length === 0) {            // nothing left to summarise
    logInfo('[pruneThread] nothing to summarise after role-filter');
    return;
  }

  /* 3) build a short summary */
  logInfo(`[pruneThread] summarising ${head.length} msgs`);
  await rateLimit();
  const summaryResp = await createChatCompletion({
    model: SUMM_MODEL,
    messages: [
      { role: 'system', content: 'Summarise the following conversation briefly & accurately:' },
      ...head.map(m => ({ role: m.role, content: flattenContent(m.content) }))
    ],
    max_tokens: PRUNED_SUMMARY_TOKENS,
    temperature: 0.2
  });
  const summary = summaryResp.choices[0].message.content.trim();

  /* 4) delete the head messages (inc. dropped “tool” ones) */
  for (const m of head) {
    await rateLimit();
    await deleteThreadMessage(threadId, m.id);
  }

  /* 5) insert the summary */
  await rateLimit();
  await createThreadMessage(threadId, {
    role: 'system',
    content: [{ type: 'text', text: `Conversation summary:\n${summary}` }]
  });

  /* 6) recompute ctx tally */
  const newTotal = estimateTokensFromString(summary) +
    liveTail.reduce((t, m) => t + estimateTokensFromString(flattenContent(m.content)), 0);
  threadTokenTally.set(threadId, newTotal);

  logInfo(`[pruneThread] DONE  new ctxTok=${newTotal}`);
}


// ─── Token estimation ────────────────────────────────────────────────

export function estimateTokensFromString(str = '') {
  // 4.1 chars ≈ 1 token on average for English text.
  // Add 10 tokens of pad, then inflate by 15 %.
  const rough = Math.ceil(str.length / 4.1) + 10;
  return Math.ceil(rough * 1.15);
}

async function throttleByTokens(estimate = 0) {
  cleanTokenHistory();

  // how many tokens we’ll try to reserve (capped at your per-minute limit)
  const want = Math.min(
    Math.ceil(estimate * RUN_SAFE_MULT),
    TOKEN_LIMIT_PER_MIN
  );

  // nothing to reserve → no throttle
  if (want <= 0) {
    return;
  }

  // total used in the last 60s
  const used = tokenHistory.reduce((sum, e) => sum + e.tokens, 0);
  logInfo(`[throttle] want=${want}  usedLast60s=${used}  limit=${TOKEN_LIMIT_PER_MIN}`);

  // if it fits, reserve and go
  if (used + want <= TOKEN_LIMIT_PER_MIN) {
    tokenHistory.push({ ts: Date.now(), tokens: want });
    return;
  }

  // bucket exhausted → back off until the oldest record is 60s old
  logWarn('[throttle] bucket exhausted — entering backoff sleep');
  const oldestTs = tokenHistory[0]?.ts || Date.now();
  const releaseTs = oldestTs + 60_000;
  const waitMs = Math.max(0, releaseTs - Date.now());

  if (waitMs > 0) {
    logWarn(`[throttle] sleeping ${waitMs} ms to free up tokens`);
    await new Promise(r => setTimeout(r, waitMs));
  }

  logInfo('[throttle] backoff over, resuming');
  tokenHistory.push({ ts: Date.now(), tokens: want });
}





// ─── Init conversation ────────────────────────────────────────────────
export async function initConversation(threadId, title, savedDir) {
  logInfo(`initConversation (threadId=${threadId})`);

  let localId, convo;

  /* 1. load or create the thread + local convo object */
  if (threadId) {
    localId = threadId;
    logInfo(`Loading existing convo file`);
    convo = await loadConversation(path.join(savedDir, `${localId}.txt`));
  } else {
    logInfo(`Creating new thread via API`);
    await rateLimit();
    logInfo(`API CALL: create thread`);
    const thread = await createThread();
    localId = thread.id;
    convo   = { messages: [], openaiThreadId: thread.id, title: title || '' };
    logSuccess(`Thread created ${thread.id}`);
  }

  /* 2. set a default title if missing */
  if (!convo.title) {
    convo.title = title || localId || 'Chat';
    logInfo(`Conversation title set to "${convo.title}"`);
  }

  /* 3. rebuild the token-tally for this thread once */
  if (convo.openaiThreadId && !threadTokenTally.has(convo.openaiThreadId)) {
    const tally = (convo.messages || []).reduce(
      (tot, m) => tot + estimateTokensFromString(flattenContent(m.content || '')),
      0
    );
    threadTokenTally.set(convo.openaiThreadId, tally);
    logInfo(`[initConversation] ctxTokens rebuilt → ${tally}`);
  }

  /* 4. prune immediately if the history is already heavy */
  if (convo.openaiThreadId) {
    await pruneThread(convo.openaiThreadId);   // rate-limited inside
  }

  /* 5. done */
  return { localId, convo };
}

// ─── Post a user message ─────────────────────────────────────────────
export async function postUserMessage(openaiThreadId, prompt) {
  logInfo(`API CALL: postUserMessage to thread ${openaiThreadId}`);
  const msg = await safeCreateMessage(openaiThreadId, {
    role: 'user',
    content: [{ type:'text', text: prompt.trim() }]
  });
  return msg;
}

// ─── Thread & run helpers ────────────────────────────────────────────
export async function createRunWithRateLimitRetry(threadId, assistantId, userPrompt, tools) {
  const instrString = userPrompt.trim();
  const instrTok    = estimateTokensFromString(instrString);

  // ensure context will still fit
  const COMP_BUF = 5_000;                
  await shrinkContextIfNeeded(threadId, instrTok + COMP_BUF);

  // compute your ideal reserve
  const ctxTok       = threadTokenTally.get(threadId) || 0;
  const rawReserve   = Math.ceil((ctxTok + instrTok) * RUN_SAFE_MULT) + COMP_BUF;
  const MAX_RESERVE  = TOKEN_LIMIT_PER_MIN - 1_000;

  // clamp to the model’s per-minute bucket minus what’s already used
  const used         = tokenHistory.reduce((sum, e) => sum + e.tokens, 0);
  const remainingMin = TOKEN_LIMIT_PER_MIN - used - COMP_BUF;
  const finalReserve = Math.min(rawReserve, MAX_RESERVE, Math.max(0, remainingMin));

  // throttle before creating the run
  await throttleByTokens(finalReserve);
  await rateLimit();

  // fire off the run, retrying on TPM errors
  let run;
  while (true) {
    try {
      run = await createThreadRun(threadId, {
        assistant_id: assistantId,
        instructions: instrString,
        tools,
        tool_choice: 'auto'
      });
      break;
    } catch (err) {
      if (err.message.includes('rate_limit_exceeded')) {
        const m = err.message.match(/try again in\s*([\d.]+)s/i);
        const backoff = m ? parseFloat(m[1]) * 1000 : 60_000;
        logWarn(`Run creation rate-limited, sleeping ${backoff}ms…`);
        await new Promise(r => setTimeout(r, backoff));
      } else {
        throw err;
      }
    }
  }

  // account for the reservation in your token history
  tokenHistory.push({
    ts:     Date.now(),
    tokens: finalReserve,
    tag:    run.id
  });

  return run;
}



// ─── Wait for a run to finish, then record its token usage ──────────
export async function waitForRunCompletion(threadId, runId) {
  await rateLimit();
  let run = await retrieveThreadRun(threadId, runId);

  // keep polling until it’s done, but allow cancellation at each step
  while (['queued', 'in_progress'].includes(run.status)) {
    checkCancel(threadId);
    await new Promise(r => setTimeout(r, 500));
    await rateLimit();
    run = await retrieveThreadRun(threadId, runId);;
  }

  // final cancellation check before we record or return
  checkCancel(threadId);

  if (run.usage?.total_tokens) {
    tokenHistory.push({ ts: Date.now(), tokens: run.usage.total_tokens });
    cleanTokenHistory();
  }

  if (run.status === 'failed' || run.status === 'errored') {
    console.error(
      `Run ${run.id} failed:`,
      run.last_error?.code,
      run.last_error?.message
    );
  }

  return run;
}

// Handler to clear queued/in-progress runs for a thread:
export async function cancelRun(ctx) {
  const { thread_id } = ctx.params;
  let convo;

  try {
    convo = await loadConversation(path.join(SAVED_DIR, `${thread_id}.txt`));
  } catch {
    return ctx.json(404, { error: 'Thread not found' });
  }
  if (!convo.openaiThreadId) {
    return ctx.json(404, { error: 'No OpenAI thread mapped' });
  }

  // mark cancellation
  requestCancel(convo.openaiThreadId);

  try {
    return ctx.json(200, { canceled: true });
  } catch (err) {
    return ctx.json(500, { error: err.message });
  }
}

/**
 * Summarize each tool output in one shot, preserving tool_call_id,
 * submit them as a single payload, then return immediately so the
 * main run loop can pick up the next state.
 */
async function summarizePerCall(threadId, runId, toolCalls, toolOutputs) {
  logWarn('[summarizePerCall] falling back to per-call summarization…');

  // 1) build per-call entries with their own summary_prompt
  const entries = toolCalls.map(tc => {
    const args = JSON.parse(tc.function?.arguments ?? tc.arguments);
    const id   = tc.id;
    const out  = toolOutputs.find(o => o.tool_call_id === id)?.output || '';
    return { tool_call_id: id, summary_prompt: args.summary_prompt, output: out };
  });

  // 2) build one big user prompt tagging each with its own system prompt
  const joined = entries
    .map(e =>
      `### ${e.tool_call_id}
System prompt: ${e.summary_prompt}
${e.output}`
    )
    .join('\n\n');

  const system = `You are a concise summarizer.
For each of the above tool outputs, produce a short summary that contains exactly the essential information the assistant needs,
using the “System prompt” provided for that output.
Return a JSON array of objects, each with two keys:
- "tool_call_id" (same as input)
- "output"      (the summary string)
Do NOT emit any extra text as it will be parsed directly into submitToolOutputs as the tool_outputs array`;

  // 3) ask the summarizer
  const resp = await createChatCompletion({
    model: SUMM_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: joined }
    ],
    temperature: 0.2,
    max_tokens: SUMM_LIMIT
  });

  // 4) parse the JSON array back into our summaries
  let summaries;
  try {
    summaries = JSON.parse(resp.choices[0].message.content);
  } catch (err) {
    throw new Error('[summarizePerCall] JSON parse error: ' + err.message);
  }

  // 5) submit those as a single payload
  await waitForRunCompletion(threadId, runId);
  await throttleByTokens(estimateTokensFromString(JSON.stringify(summaries)) + COMP_BUF);
  await rateLimit();

  await submitRunToolOutputs(threadId, runId, { tool_outputs: summaries });
  cycleAnswered(runId);
  logInfo('[summarizePerCall] submitted summarized payload');
}

/**
 * Try to submit all toolOutputs at once.
 * If it exceeds your per-minute bucket, fall back to summarizePerCall().
 * In every case we wait again so the run loop can continue.
 */
export async function submitToolOutputsSafe(
  threadId,
  runId,
  toolCalls,    // ← new
  toolOutputs
) {
  // ensure our context is in shape
  await pruneThread(threadId);

  const fullJson   = JSON.stringify(toolOutputs);
  const fullTokens = estimateTokensFromString(fullJson);
  logInfo(`[submitToolOutputsSafe] full payload ≈ ${fullTokens} tokens`);

  // if it fits under TPM, send in one go
  if (fullTokens <= TOKEN_LIMIT_PER_MIN - COMP_BUF) {
    logInfo('[submitToolOutputsSafe] payload fits under TPM → sending all at once');

    await waitForRunCompletion(threadId, runId);
    await throttleByTokens(fullTokens + COMP_BUF);
    await rateLimit();
    await submitRunToolOutputs(threadId, runId, { tool_outputs: toolOutputs });
    cycleAnswered(runId);
    logSuccess('[submitToolOutputsSafe] full payload sent, please wait this may take a while.');

    // unblock the run
    await waitForRunCompletion(threadId, runId);
    return;
  }

  // otherwise summarise each call individually
  await summarizePerCall(threadId, runId, toolCalls, toolOutputs);
}


// ─── Prevent double-submitting the same tool_calls ────────────────
const answeredToolCallCycle = new Map();          // runId → true

function cycleAnswered(runId)       { answeredToolCallCycle.set(runId, true); }
function resetCycleFlag(runId)      { answeredToolCallCycle.delete(runId);    }
function alreadyAnswered(runId)     { return answeredToolCallCycle.has(runId); }

//this doesn't work, openai expects all outputs at once for a set that was called, so we can't chunk outputs
export async function submitChunksSeparately(threadId, runId, entries) {
  for (const entry of entries) {
    // throttle, cancel-check, etc. as before…
    await throttleByTokens(estimateTokensFromString(JSON.stringify(entry)) + COMP_BUF);
    await pruneThread(threadId);
    // send exactly one tool_output per call
    await submitRunToolOutputs(threadId, runId, { tool_outputs: [ entry ] });
    await new Promise(r => setTimeout(r, 1000));
    // wait for the model to pick it up before next chunk
    await waitForRunCompletion(threadId, runId);
  }
}



// ─── Safe POST of a user message with dynamic TPM check & cancel ────
export async function safeCreateMessage(threadId, params) {
  while (true) {
    // allow pruning if history is bloated
    await pruneThread(threadId);

    checkCancel(threadId);

    // build flat-text payload to estimate tokens
    let text = '';
    if (Array.isArray(params.content)) {
      text = params.content
        .map(c => (typeof c.text === 'string' ? c.text : c.text.value))
        .join('');
    } else {
      text = typeof params.content === 'string'
        ? params.content
        : JSON.stringify(params.content);
    }
    const estimate = estimateTokensFromString(text);

    // wait for enough remaining bucket
    cleanTokenHistory();
    const used      = tokenHistory.reduce((s,e)=>s+e.tokens,0);
    const remaining = TOKEN_LIMIT_PER_MIN - used;
    if (estimate > remaining) {
      const waitUntil = tokenHistory[0].ts + 60_000;
      await new Promise(r=>setTimeout(r, Math.max(0, waitUntil-Date.now())));
    }

    await throttleByTokens(estimate);
    try {
      const msg = await createThreadMessage(threadId, params);
      addToThreadTally(threadId, params.content);
      return msg;
    } catch (err) {
      if (err.status === 400 && err.error?.message.includes('active run')) {
        await waitForActiveRuns(threadId);
        continue;
      }
      throw err;
    }
  }
}




// ─── Persistence ─────────────────────────────────────────────────────
export async function loadConversation(fp) {
  logInfo(`Loading conversation from ${fp}`);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    logSuccess(`File read successfully`);
    const data = JSON.parse(raw);
    logSuccess(`JSON parsed, ${Array.isArray(data) ? data.length : data.messages.length} messages`);
    if (Array.isArray(data)) {
      return { messages: data, openaiThreadId: null, title: '' };
    }
    return {
      messages:       data.messages || [],
      openaiThreadId: data.openaiThreadId || null,
      title:          data.title || data.openaiThreadId
    };
  } catch (err) {
    logWarn(`Could not load conversation (${err.message}), starting fresh`);
    return { messages: [], openaiThreadId: null, title: '' };
  }
}

export async function saveConversation(fp, convo) {
  logInfo(`Saving conversation to ${fp}`);
  await fs.mkdir(path.dirname(fp), { recursive:true });
  await fs.writeFile(fp,
    JSON.stringify({
      openaiThreadId: convo.openaiThreadId,
      title:          convo.title || convo.openaiThreadId,
      messages:       convo.messages
    }, null,2),
    'utf-8'
  );
  logSuccess(`Conversation saved (${convo.messages.length} messages)`);
}

// ─── Ensure or create assistant ──────────────────────────────────────
export async function ensureAssistant() {
  logInfo(`Ensuring assistant exists`);
  let existing;
  try {
    logInfo(`Reading assistant file ${ASSISTANT_FILE}`);
    const raw = await fs.readFile(ASSISTANT_FILE, 'utf-8');
    existing = JSON.parse(raw);
    logSuccess(`Found existing assistant ID ${existing.assistantId}`);
  } catch {
    logWarn(`No existing assistant file`);
    existing = null;
  }

  const currentInstr = DEFAULT_SYSTEM_PROMPT.trim();
  if (existing?.assistantId && existing.instructions === currentInstr) {
    logSuccess(`Using cached assistant ${existing.assistantId}`);
    return existing.assistantId;
  }

  if (existing?.assistantId) {
    logWarn(`Instructions changed; deleting old assistant ${existing.assistantId}`);
    try {
      await rateLimit();
      logInfo(`API CALL: delete assistant ${existing.assistantId}`);
      await deleteAssistant(existing.assistantId);
      logSuccess(`Deleted assistant ${existing.assistantId}`);
    } catch (err) {
      logError(`Failed to delete old assistant: ${err.message}`);
    }
  }

  logInfo(`Creating new assistant`);
  await rateLimit();
  logInfo(`API CALL: create assistant`);
  const asst = await createAssistant({
    name: 'Server Assistant',
    instructions: currentInstr,
    tools: [], // function‐calling only
    model: BASE_MODEL
  });
  const assistantId = asst.id;
  logSuccess(`Created assistant ${assistantId}`);

  await fs.mkdir(path.dirname(ASSISTANT_FILE), { recursive:true });
  await fs.writeFile(ASSISTANT_FILE,
    JSON.stringify({ assistantId, instructions:currentInstr }, null,2),
    'utf-8'
  );
  logSuccess(`Assistant file updated`);
  return assistantId;
}


// ─── Core prompt flow ─────────────────────────────────────────────────
export async function handlePrompt({ prompt, threadId, title, systemPrompt }, savedDir) {
  if (!prompt?.trim()) {
    return { error: true, errorMessage: 'Missing prompt', logs: [] };
  }

  let allLogs = [];
  let convo, localId, assistantId;

  // 1) Setup assistant & conversation
  assistantId = await ensureAssistant();
  ({ localId, convo } = await initConversation(threadId, title, savedDir));

  // 2) Lock & clear prior runs
  await lockThread(convo.openaiThreadId);
  try {
    checkCancel(convo.openaiThreadId);
    if (convo.openaiThreadId) {
      await waitForActiveRuns(convo.openaiThreadId);
      checkCancel(convo.openaiThreadId);
    }

    // 3) Try up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // a) clear stray runs before posting
        if (convo.openaiThreadId) {
          await waitForActiveRuns(convo.openaiThreadId);
          checkCancel(convo.openaiThreadId);
        }

        // b) throttle for user prompt
        let userMsg;
        if (attempt === 1) {
          userMsg = await safeCreateMessage(convo.openaiThreadId, {
            role: 'user',
            content: [{ type: 'text', text: prompt.trim() }]
          });
        }
        checkCancel(convo.openaiThreadId);
        if (userMsg) convo.messages.push(userMsg);

        // c) run assistant + tools
        const { fnLogs, selfPrompt } = await runAssistantLoop(
          convo.openaiThreadId,
          assistantId,
          systemPrompt || DEFAULT_SYSTEM_PROMPT
        );
        checkCancel(convo.openaiThreadId);
        allLogs.push(...fnLogs);

        // d) fetch the reply
        const asst = await fetchAssistantReply(
          convo.openaiThreadId,
          fnLogs,
          runAssistantLoop.lastStatus
        );
        checkCancel(convo.openaiThreadId);

        if (runAssistantLoop.lastStatus !== 'completed') {
          throw new Error(`Run failed: ${runAssistantLoop.lastStatus}`);
        }

        // e) record & optionally handle self-prompt loops
        convo.messages.push(asst);

        let sp = selfPrompt;
        while (sp) {
          const { userMsg, asstMsg, nextSelf } =
            await handleSelfPrompt(convo.openaiThreadId, assistantId, sp);

          // record the two new messages
          convo.messages.push(userMsg);
          convo.messages.push(asstMsg);

          // prepare for the next loop
          sp = nextSelf;
        }

        // f) persist
        await saveConversation(path.join(savedDir, `${localId}.txt`), convo);

        return {
          userMessageId: userMsg?.id,
          error: false,
          logs: allLogs,
          result: flattenContent(asst.content),
          threadId: localId,
          openaiThreadId: convo.openaiThreadId,
          assistantMessageId: asst.id
        };
      } catch (err) {
        // **Cancellation is final—don’t retry**
        if (err.message === 'Cancelled by user') {
          return {
            error: false,
            result: '🛑 Operation cancelled.',
            logs: allLogs,
            threadId: localId,
            openaiThreadId: convo.openaiThreadId
          };
        }

        // Otherwise record a retry and loop again (up to 3)
        allLogs.push({ type: 'retry', attempt, error: err.message });
        if (attempt === 3) {
          throw err;
        }
      }
    }
  } catch (err) {
    return { error: true, errorMessage: err.message, logs: allLogs };
  } finally {
    unlockThread(convo.openaiThreadId);
  }
}

/**
 * Waits until there are no more runs in queued/in_progress/requires_action.
 */
export async function waitForActiveRuns(threadId) {
  const fnLogs = [];

  while (true) {
    checkCancel(threadId);

    // Fetch the most recent 100 runs
    const res = await listThreadRuns(threadId, { limit: 100 });
    const liveRuns = res.data.filter(r =>
      ['queued', 'in_progress', 'requires_action'].includes(r.status)
    );

    // If none left, we’re done
    if (liveRuns.length === 0) {
      return fnLogs;
    }

    // Handle each active run
    for (const run of liveRuns) {
      checkCancel(threadId);

      if (run.status === 'requires_action') {
        // a) execute pending tool calls
        const tc = run.required_action.submit_tool_outputs.tool_calls;
        const { fnLogs: newLogs, follow } = await runToolCalls(tc, threadId);
        fnLogs.push(...newLogs);

        // b) collect their outputs
        const outs = follow
          .filter(m => m.role === 'tool')
          .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }));

        // c) re-submit them with the original definitions
        await submitToolOutputsSafe(threadId, run.id, tc, outs);

        // d) wait for this run to move past requires_action
        await waitForRunCompletion(threadId, run.id);

      } else {
        // queued or in_progress → just wait it out
        await waitForRunCompletion(threadId, run.id);
      }
    }

    // Brief pause before the next poll
    await new Promise(r => setTimeout(r, 200));
  }
}


// ─── Main assistant run loop, now using both throttles ─────────────
export async function runAssistantLoop(threadId, assistantId, instructions) {
  // 1) start the run
  const run = await createRunWithRateLimitRetry(threadId, assistantId, instructions, tools);
  const fnLogs = [];
  const toolCallsHandled = new Set();
  let selfPrompt = null;

  while (true) {
    // 2) wait until it's no longer queued/in_progress
    const finished = await waitForRunCompletion(threadId, run.id);

    if (finished.status === 'requires_action') {
      // only handle each requires_action once
      if (!toolCallsHandled.has(finished.id)) {
        // a) run the tool calls the model asked for
        const tc = finished.required_action.submit_tool_outputs.tool_calls;
        const { fnLogs: newLogs, follow, selfPrompt: sp } =
          await runToolCalls(tc, threadId);
        fnLogs.push(...newLogs);
        if (sp) selfPrompt = sp;

        // b) collect their outputs
        const outs = follow
          .filter(m => m.role === 'tool')
          .map(t => ({ tool_call_id: t.tool_call_id, output: t.content }));

        // c) re-submit them **with** the original tc array
        await submitToolOutputsSafe(threadId, run.id, tc, outs);

        toolCallsHandled.add(finished.id);
      }

      // loop back and poll again
      continue;
    }

    // any other status (completed, failed, errored) → exit
    runAssistantLoop.lastStatus = finished.status;
    break;
  }

  return { fnLogs, selfPrompt };
}



// ─── Fetch or fallback assistant reply ────────────────────────────────
export async function fetchAssistantReply(threadId, fnLogs, lastStatus) {
  checkCancel(threadId);
  logInfo(`Listing last messages for thread ${threadId}`);
  await rateLimit();
  logInfo(`API CALL: list messages`);
  const { data: messages } = await listThreadMessages(threadId, { limit: 20, order: 'desc' })
  
  await listThreadMessages(threadId, { limit: 20, order: 'desc' });

  let asst = messages.find(m => m.role === 'assistant');
  if (!asst || lastStatus !== 'completed') {
    const text = `⚠️ Error: run status ${lastStatus}`;
    logWarn(`No completed assistant message, synthesizing error reply`);
    asst = {
      id: `synthetic_${Date.now()}`,
      role: 'assistant',
      created_at: Math.floor(Date.now()/1000),
      content: [{ type:'text', text: { value: text, annotations: [] } }]
    };
  }
  return asst;
}

// ─── Self-prompt continuation ────────────────────────────────────────
export async function handleSelfPrompt(threadId, assistantId, selfPrompt) {
  // 1a. Post the self-prompt as if it were a user message
  const userMsg = await safeCreateMessage(threadId, {
    role: 'user',
    content: [{ type: 'text', text: selfPrompt }]
  });

  // 1b. Kick off a new run, with the same tools & throttles
  const run = await createRunWithRateLimitRetry(
    threadId,
    assistantId,
    selfPrompt,
    tools
  );

  // 1c. Loop through queued → requires_action → tool calls → completed
  const { fnLogs, selfPrompt: nextSelf } =
    await runAssistantLoop(threadId, assistantId, selfPrompt);

  // 1d. Once completed, fetch the assistant’s reply
  const asstMsg = await fetchAssistantReply(
    threadId,
    fnLogs,
    runAssistantLoop.lastStatus
  );

  // 1e. Return both messages *and* any follow-up prompt
  return { userMsg, asstMsg, nextSelf };
}
