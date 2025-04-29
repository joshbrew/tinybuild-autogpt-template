
import OpenAI from 'openai';

import dotenv from 'dotenv';
dotenv.config();

// ─── Runtime config ─────────────────────────────────────────────────
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

//there are more params available if you look at the functions

//we can use this as a foundation to generalize e.g. to claude or gemini or offline models (e.g. with an api that mimics openai's)

/**
 * Send a chat completion request.
 *
 * @param {Object} params
 * @param {string} params.model           - Model ID (e.g. SMART_MODEL or SUMM_MODEL)
 * @param {Array<Object>} params.messages - Array of message objects: { role, content }
 * @param {number} [params.temperature]   - Sampling temperature
 * @param {number} [params.max_tokens]    - Max tokens in the response
 * @returns {Promise<Object>}             - OpenAI chat completion response
 */
export async function createChatCompletion(params) {
    return openai.chat.completions.create(params);
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
   * Kick off a new run in a thread (assistant + tools).
   *
   * @param {string} threadId - OpenAI thread ID
   * @param {Object} params   - { assistant_id, instructions, tools, tool_choice }
   * @returns {Promise<Object>} - The run object, with `id` and initial status
   */
  export async function createThreadRun(threadId, params) {
    return openai.beta.threads.runs.create(threadId, params);
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
  