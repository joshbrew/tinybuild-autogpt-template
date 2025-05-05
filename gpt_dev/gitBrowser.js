// ./gpt_dev/git-desktop.js
import './gitBrowser.css';
import { API_BASE } from './frontendUtil.js';

const template = document.createElement('template');
template.innerHTML = `
  <div class="git-desktop">
    <header class="gd-toolbar">
      <select class="gd-branch-selector"></select>
      <select class="gd-versions-selector" disabled></select>

      <!-- panel tabs -->
      <div class="gd-panel-tabs">
        <button data-panel="diff" class="active">Diff</button>
        <button data-panel="changes">Changes</button>
      </div>

      <!-- operations -->
      <button class="gd-btn" data-op="fetch-all">Fetch</button>
      <button class="gd-btn" data-op="pull">Pull</button>
      <!-- …rest of your buttons… -->
    </header>

    <!-- two overlay cards -->
    <div class="gd-overlays">
      <div class="gd-overlay gd-overlay--diff active">
        <h3>Diff</h3>
        <pre class="gd-diff-content"></pre>
      </div>

      <div class="gd-overlay gd-overlay--changes">
        <h3>Changes & Commit</h3>
        <div class="gd-file-panel">
          <h4>Unstaged</h4>
          <ul class="gd-unstaged-list"></ul>
          <h4>Staged</h4>
          <ul class="gd-staged-list"></ul>
        </div>
        <div class="gd-commit-panel">
          <textarea class="gd-commit-msg" placeholder="Commit message…"></textarea>
          <button class="gd-btn gd-commit-btn" disabled>
            Commit to <span class="gd-current-branch"></span>
          </button>
        </div>
      </div>
    </div>

    <div class="gd-toast" hidden></div>
  </div>
`;


class GitDesktop extends HTMLElement {
    constructor() {
        super();
        this._init = false;
        this.currentBranch = '';
    }

    connectedCallback() {
        if (this._init) return;
        this._init = true;
        this.append(template.content.cloneNode(true));
      
        // Elements
        this.branchSelector      = this.querySelector('.gd-branch-selector');
        this.toolbarBtns         = this.querySelectorAll('.gd-btn[data-op]');
        this.unstagedList        = this.querySelector('.gd-unstaged-list');
        this.stagedList          = this.querySelector('.gd-staged-list');
        this.commitMsg           = this.querySelector('.gd-commit-msg');
        this.commitBtn           = this.querySelector('.gd-commit-btn');
        this.currentBranchLabel  = this.querySelector('.gd-current-branch');
        this.toast               = this.querySelector('.gd-toast');
      
        // Optional elements (may not exist until injected)
        this.diffPanel           = this.querySelector('.gd-overlay--diff');
        this.collapseBtn         = this.querySelector('.gd-collapse-btn');
        this.versionSelector     = this.querySelector('.gd-versions-selector');
        this.diffContent         = this.querySelector('.gd-diff-content');
        this.overlays            = this.querySelectorAll('.gd-overlay');
        this.tabButtons          = this.querySelectorAll('.gd-panel-tabs button');
      
        // Events
        this.branchSelector.addEventListener('change', () => this.checkoutBranch());
        this.toolbarBtns.forEach(b =>
          b.addEventListener('click', () => this._onToolbar(b.dataset.op))
        );
        this.commitMsg.addEventListener('input', () =>
          this.commitBtn.disabled = !this.commitMsg.value.trim()
        );
        this.commitBtn.addEventListener('click', () => this.commit());
      
        // Collapse toggle (guarded)
        if (this.collapseBtn && this.diffPanel) {
          this.collapseBtn.addEventListener('click', () =>
            this.diffPanel.classList.toggle('collapsed')
          );
        }
      
        // Version selector (guarded)
        if (this.versionSelector) {
          this.versionSelector.addEventListener('change', () => {
            const ref = this.versionSelector.value;
            if (ref) this.loadDiff(ref);
          });
        }
      
        // Panel tabs (guarded)
        if (this.tabButtons.length && this.overlays.length) {
          this.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
              // deactivate all
              this.tabButtons.forEach(b => b.classList.remove('active'));
              this.overlays.forEach(o => o.classList.remove('active'));
              // activate this one
              btn.classList.add('active');
              const panelName = btn.dataset.panel; // "diff" or "changes"
              const overlay = this.querySelector(`.gd-overlay--${panelName}`);
              if (overlay) overlay.classList.add('active');
            });
          });
        }
        // grab the toast element (rename from `this.toast`)
        this.toastEl = this.querySelector('.gd-toast');

        // branch dropdown change
        this.branchSelector.addEventListener('change', () => this.checkoutBranch());

        // Initial data load
        this.loadBranches().then(() => {
          this.loadStatus();
          this.loadVersions();
        });
      }
      

    async _api(path, method = 'GET', body = null) {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(`${API_BASE}${path}`, opts);
        if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
        return res.json();
    }

    async loadVersions() {
        // fetch the "<sha> <message>" lines
        const { versions } = await this._api('/api/git/versions', 'POST', { maxCount: 50 });
      
        // build options whose value is only the SHA
        this.versionSelector.innerHTML = versions.map(entry => {
          const [sha, ...rest] = entry.split(' ');
          return `<option value="${sha}">${entry}</option>`;
        }).join('');
      
        // if there’s at least one, immediately load its diff
        if (versions.length) {
          const firstSha = versions[0].split(' ')[0];
          this.versionSelector.value = firstSha;
          this.loadDiff(firstSha);
        }
      }
      
      async loadDiff(ref) {
        try {
          const { changelog } = await this._api('/api/git/changelog','POST',{ ref });
          this.diffContent.textContent = changelog;
        } catch (err) {
          console.error(err);
          this.showToast(`Error loading diff: ${err.message}`, true);
        }
      }

    // ─── BRANCHES ─────────────────────────────────────────────────────────
    async loadBranches() {
        const { branches } = await this._api('/api/git/branches', 'GET');
        this.branchSelector.innerHTML = branches.map(b => `<option>${b}</option>`).join('');
        const { branch } = await this._api('/api/git/current-branch', 'GET');
        this.branchSelector.value = branch;
        this.currentBranch = branch;
        this.currentBranchLabel.textContent = branch;
    }

    async checkoutBranch() {
      const target = this.branchSelector.value;
      try {
        await this._api('/api/git/branches/restore', 'POST', { branch: target });
        this.currentBranch = target;
        this.currentBranchLabel.textContent = target;
        this.showToast(`Checked out ${target}`);
      } catch (err) {
        console.error('Branch checkout failed:', err);
        this.showToast(`Error switching to ${target}: ${err.message}`, true);
      } finally {
        this.loadStatus();
      }
    }

    async newBranch() {
        const name = prompt('New branch name:');
        if (!name) return;
        await this._api('/api/git/branches', 'POST', { branch: name });
        await this.loadBranches();
        this.showToast(`Branch ${name} created`);
    }

    async deleteBranch() {
        if (!confirm(`Delete branch ${this.currentBranch}?`)) return;
        await this._api('/api/git/branches/delete', 'POST', { branch: this.currentBranch });
        this.currentBranch = '';
        this.commitBtn.disabled = true;
        this.showToast('Branch deleted');
        await this.loadBranches();
        this.loadStatus();
    }

    
    // ─── STATUS & STAGING ─────────────────────────────────────────────────
    async loadStatus() {
        // status route returns { unstaged:[], staged:[] }
        const { unstaged, staged } = await this._api('/api/git/status', 'GET');
        this._renderList(this.unstagedList, unstaged, false);
        this._renderList(this.stagedList, staged, true);
    }

    _renderList(container, files, isStaged) {
        container.innerHTML = '';
        files.forEach(f => {
            const li = document.createElement('li');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = isStaged;
            cb.addEventListener('change', () => this.toggleStage(f, cb.checked));
            li.append(cb, document.createTextNode(f));
            container.append(li);
        });
    }

    async toggleStage(file, stage) {
        const route = stage ? '/api/git/stage' : '/api/git/unstage';
        await this._api(route, 'POST', { files: [file] });
        this.loadStatus();
    }

    // ─── COMMIT ────────────────────────────────────────────────────────────
    async commit() {
        const msg = this.commitMsg.value.trim();
        if (!msg) return;
        await this._api('/api/git/commit', 'POST', { message: msg });
        this.commitMsg.value = '';
        this.showToast(`Committed to ${this.currentBranch}`);
        this.loadStatus();
    }

    // ─── OTHER OPERATIONS ─────────────────────────────────────────────────
    async fetchAll() {
        await this._api('/api/git/fetch-all', 'POST');
        this.showToast('Fetched all remotes');
    }

    async pull() {
        await this._api('/api/git/branches/pull', 'POST', { branch: this.currentBranch });
        this.showToast('Pulled latest');
        this.loadStatus();
    }

    async push() {
        await this._api('/api/git/branches/push', 'POST', { branch: this.currentBranch });
        this.showToast('Pushed to remote');
    }

    async hardReset() {
        const ref = prompt('Reset to commit (SHA or ref):', 'HEAD');
        if (ref === null) return;
        await this._api('/api/git/hard-reset', 'POST', { commit: ref });
        this.showToast(`Hard reset to ${ref}`);
        this.loadStatus();
    }

    async removeRepo() {
        if (!confirm('Remove .git and start fresh?')) return;
        await this._api('/api/git/remove-local-repo', 'POST');
        this.showToast('Local Git repo removed');
        this.loadBranches();
        this.loadStatus();
    }

    async stash() {
        const { message } = await this._api('/api/git/stash', 'POST');
        this.showToast(message);
        this.loadStatus();
    }

    async applyStash() {
        const ref = prompt('Stash ref to apply:', 'stash@{0}');
        if (ref === null) return;
        const { message } = await this._api('/api/git/apply-stash', 'POST', { stashRef: ref });
        this.showToast(message);
        this.loadStatus();
    }

    async dropStash() {
        const ref = prompt('Stash ref to drop:', 'stash@{0}');
        if (ref === null) return;
        const { message } = await this._api('/api/git/drop-stash', 'POST', { stashRef: ref });
        this.showToast(message);
    }

    async clean() {
        if (!confirm('Clean untracked files and dirs?')) return;
        await this._api('/api/git/clean', 'POST');
        this.showToast('Working directory cleaned');
        this.loadStatus();
    }

    // ─── UTILS & DISPLAYS ────────────────────────────────────────────────
    _onToolbar(op) {
        return this[op.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]();
    }

    showToast(msg, isError = false) {
        this.toastEl.textContent = msg;
        this.toastEl.classList.toggle('error', isError);
        this.toastEl.hidden = false;
        setTimeout(() => { this.toastEl.hidden = true; }, 3000);
      }
}

customElements.define('git-desktop', GitDesktop);
// document.body.append(document.createElement('git-desktop'));
