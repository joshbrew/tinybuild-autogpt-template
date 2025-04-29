//depends on model and account permissions. default for 4.1 is 30k tokens, 4.1-mini is 200k
export const BASE_MODEL = process.env.GPT_MODEL || 'gpt-4.1-mini'; //gpt-4.1-mini //<-- 200K context for mini
export const SUMM_MODEL = process.env.SUMMARY_MODEL || 'gpt-4.1-mini'; // cheap summariser
export const SMART_MODEL = process.env.SMART_MODEL || 'o4-mini'; //these don't have assistants available yet 

export const MODEL_LIMITS = {
  'gpt-4.1':      30000,
  'gpt-4.1-mini': 200000,
  'o4-mini': 200000 //assistants/threads api not yet supported
  // add others as needed
};

export const SUMM_LIMIT = 5120; //summary token limit. Change based on model constraints

export const TOKEN_LIMIT_PER_MIN =
  MODEL_LIMITS[BASE_MODEL] ?? 30000;    // fallback if MODEL isn’t in the map
export const PRUNE_AT      = Math.round(TOKEN_LIMIT_PER_MIN*1.2/3);         // prune when ctxTokens exceed this
export const KEEP_N_LIVE   = 10; // keep last N messages verbatim

export const RUN_SAFE_MULT = 1.25;  //assume higher token count by x amount for run safety
export const COMP_BUF      = 10_000; //5_000   // head-room for model reply
export const HARD_CAP      = Math.round(TOKEN_LIMIT_PER_MIN*2/3);  // leave ≈ 10 k for the model’s reply


import path from 'path'

export const SAVED_DIR = process.env.SAVED_DIR ||
  path.join(process.cwd(), 'gpt_dev/saved');

export const ASSISTANT_FILE = path.join(SAVED_DIR, 'assistant.json');
