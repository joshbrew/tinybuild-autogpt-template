/* ────────── mile-high capability map ──────────
   Each key is a broad capability bucket.
   • summary   – one-liner of what that bucket empowers
   • functions – every individual tool that belongs in the bucket
*/
export const functionCapabilityOverview = {
    'File I/O & Content Editing': {
      summary:
        'Create, read, write, duplicate, rename, move, or delete individual files; download or patch text programmatically.',
      functions: [
        'read_file',
        'write_file',
        'copy_file',
        'move_file',
        'rename_file',
        'fetch_file'
      ]
    },
  
    'Directory Management': {
      summary:
        'Inspect, list, wipe, or prune entire folders—including project-level resets that keep critical build artifacts intact.',
      functions: ['list_directory', 'remove_directory', 'reset_project']
    },
  
    'Search & Replace Automation': {
      summary:
        'Run literal or regex-based search/replace operations across one file or an entire tree—great for sweeping refactors.',
      functions: ['search_replace']
    },
  
    'Shell, Python & Runtime Execution': {
      summary:
        'Execute one-off shell commands or Python scripts right inside the workspace and capture stdout/stderr for review.',
      functions: ['run_shell', 'run_python']
    },
  
    'Long-Running Sidecars & Scheduling': {
      summary:
        'Spin up background processes, stream their live output, gracefully shut them down, or simply wait a few milliseconds.',
      functions: [
        'create_sidecar',
        'get_sidecar_output',
        'terminate_sidecar',
        'wait'
      ]
    },
  
    'AI-Assisted Workflow Helpers': {
      summary:
        'Let the assistant talk to itself for deeper reasoning, call a smarter model for richer code completions, or pull the browser console history for context.',
      functions: ['reprompt_self', 'smart_chat', 'get_console_history']
    },
  
    'Version Control (Git)': {
      summary:
        'Everything you need for lightweight Git introspection: view history, diffs, branches, remotes, stashes, comparisons, or even nuke the repo if requested.',
      functions: [
        'list_versions',
        'get_changelog',
        'remove_local_git_repo',
        'get_current_branch',
        'list_remotes',
        'set_remote_url',
        'fetch_all',
        'hard_reset',
        'stash_all',
        'apply_stash',
        'drop_stash',
        'clean_working_directory',
        'get_compare',
        'rollback_one'
      ]
    }
  };
  

  /* ═══════════════════════════════════════════════════════════════════════
   <tool-capabilities>  –  groups + displays functionCapabilityOverview
   Accepts:
     • Attribute  src="<url>.json"   – auto-fetch JSON that matches shape
     • Property   overview = { … }   – overwrite with JS object
     • Method     addCapabilities({}) – merge / extend at runtime
   ═════════════════════════════════════════════════════════════════════*/

class ToolCapabilities extends HTMLElement {
    #overview = {};
  
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          :host { display:block; font-family: system-ui, sans-serif; }
          section   { border:1px solid #ddd; border-radius:8px; margin:0 0 1rem 0;
                      background:#fff; box-shadow:0 3px 6px rgba(0,0,0,.05); }
          summary   { cursor:pointer; font-weight:600; padding:1rem;
                      list-style:none; }
          summary::-webkit-details-marker { color:#888; }
          .body     { padding:0 1rem 1rem 1rem; line-height:1.5; }
          h3        { margin:.2rem 0 .4rem 0; font-size:1rem; color:#333; }
          ul        { margin:.25rem 0 0 1.25rem; padding:0; }
          li        { font-family: monospace; font-size:.85rem; }
        </style>
        <h3>What can I do?</h3>
        <hr/>
        <div id="wrap"></div>`;
    }
  
    /* ── attr → prop reflection ───────────────────────────────────────── */
    static get observedAttributes() { return ['src']; }
    attributeChangedCallback(attr, _old, val) {
      if (attr === 'src' && val) this.#load(val);
    }
  
    /* ── public API ───────────────────────────────────────────────────── */
    set overview(obj) {
      this.#overview = typeof obj === 'object' && obj ? obj : {};
      this.#render();
    }
    get overview() { return structuredClone(this.#overview); }
  
    addCapabilities(extraObj = {}) {
      Object.entries(extraObj).forEach(([bucket, def]) => {
        this.#overview[bucket] = {
          summary: def.summary || this.#overview[bucket]?.summary || '',
          functions: [
            ...(this.#overview[bucket]?.functions || []),
            ...(def.functions || [])
          ]
        };
      });
      this.#render();
    }
  
    /* ── private helpers ──────────────────────────────────────────────── */
    async #load(url) {
      try {
        const res = await fetch(url);
        const json = await res.json();
        this.overview = json;
      } catch (err) {
        console.error('[tool-capabilities] failed to load:', err);
      }
    }
  
    #render() {
      const wrap = this.shadowRoot.getElementById('wrap');
      wrap.textContent = '';
  
      Object.entries(this.#overview).forEach(([bucket, def]) => {
        const details = document.createElement('details');
        details.open = true;
  
        const summary = document.createElement('summary');
        summary.textContent = bucket;
        details.appendChild(summary);
  
        const body = document.createElement('div');
        body.className = 'body';
  
        const p = document.createElement('p');
        p.textContent = def.summary || '';
        body.appendChild(p);
  
        if (Array.isArray(def.functions) && def.functions.length) {
          const h3 = document.createElement('h3');
          h3.textContent = 'Functions';
          body.appendChild(h3);
  
          const ul = document.createElement('ul');
          def.functions.forEach(fnName => {
            const li = document.createElement('li');
            li.textContent = fnName;
            ul.appendChild(li);
          });
          body.appendChild(ul);
        }
        details.appendChild(body);
        wrap.appendChild(details);
        details.querySelector('summary').after(document.createElement('hr'));
      });
    }
  }
  
  customElements.define('tool-capabilities', ToolCapabilities);