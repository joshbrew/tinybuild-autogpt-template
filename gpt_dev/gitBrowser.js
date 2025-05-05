// ./gpt_dev/git-desktop.js
import './gitBrowser.css';
import { API_BASE } from './frontendUtil.js';

const template = document.createElement('template');
template.innerHTML = `
  <div class="git-desktop">
    <header class="gd-toolbar">
     <span class="gd-current-branch-toolbar">On: <strong class="gd-current-branch-toolbar-value"></strong></span>  
    <select class="gd-branch-selector"></select>
      <button class="gd-btn gd-switch-btn" disabled>Switch</button>
     <button class="gd-btn gd-compare-btn" disabled>Compare</button>
      <select class="gd-versions-selector" disabled></select>

      <div class="gd-panel-tabs">
        <button data-panel="diff" class="active">Diff</button>
        <button data-panel="changes">Changes</button>
      </div>

      <details class="gd-more-menu">
        <summary>•••</summary>
        <div class="gd-menu-items">
          <button class="gd-btn" data-op="rollback-one">Rollback One</button>
          <button class="gd-btn" data-op="fetch-all">Fetch</button>
          <button class="gd-btn" data-op="pull">Pull</button>
          <button class="gd-btn" data-op="push">Push</button>
          <button class="gd-btn" data-op="hard-reset">Reset</button>
          <button class="gd-btn" data-op="new-branch">New Branch</button>
          <button class="gd-btn" data-op="delete-branch">Delete Branch</button>
          <button class="gd-btn" data-op="stash">Stash</button>
          <button class="gd-btn" data-op="apply-stash">Apply Stash</button>
          <button class="gd-btn" data-op="drop-stash">Drop Stash</button>
          <button class="gd-btn" data-op="clean">Clean</button>
          <button class="gd-btn" data-op="remove-repo">Remove Repo</button>
        </div>
      </details>
    </header>

    <div class="gd-overlays">
      <div class="gd-overlay gd-overlay--diff active">
        <h3>Diff</h3>
        <div class="gd-diff-tabs"></div>
        <pre class="gd-diff-content"></pre>
      </div>

      <div class="gd-overlay gd-overlay--changes">
        <h3>Changes & Commit</h3>
          <div class="gd-file-panel">
            <h4>
            Unstaged
            <button class="gd-btn gd-stage-all-btn">Stage All</button>
          </h4>
          <ul class="gd-unstaged-list"></ul>
          <h4>
            Staged
            <button class="gd-btn gd-unstage-all-btn">Unstage All</button>
          </h4>
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

    // grab elements
    this.branchSelector       = this.querySelector('.gd-branch-selector');
    this.switchBtn            = this.querySelector('.gd-switch-btn');
    this.currentBranchToolbar = this.querySelector('.gd-current-branch-toolbar-value');
    this.compareBtn           = this.querySelector('.gd-compare-btn');
    this.versionSelector      = this.querySelector('.gd-versions-selector');
    this.toolbarBtns          = this.querySelectorAll('.gd-btn[data-op]');
    
    this.unstagedList = this.querySelector('.gd-unstaged-list');
    this.stagedList   = this.querySelector('.gd-staged-list');

    this.stageAllBtn      = this.querySelector('.gd-stage-all-btn');
    this.unstageAllBtn    = this.querySelector('.gd-unstage-all-btn');
    // …
    this.stageAllBtn.addEventListener('click', () => this.stageAll());
    this.unstageAllBtn.addEventListener('click', () => this.unstageAll());

    this.commitMsg = this.querySelector('.gd-commit-msg');
    this.commitBtn = this.querySelector('.gd-commit-btn');
    this.currentBranchLabel = this.querySelector('.gd-current-branch');
    this.toastEl = this.querySelector('.gd-toast');

    // optional controls
    this.diffPanel = this.querySelector('.gd-overlay--diff');
    this.diffTabs = this.querySelector('.gd-diff-tabs');
    this.collapseBtn = this.querySelector('.gd-collapse-btn');
    this.diffContent = this.querySelector('.gd-diff-content');
    this.overlays = this.querySelectorAll('.gd-overlay');
    this.tabButtons = this.querySelectorAll('.gd-panel-tabs button');

    // events
    this.branchSelector.addEventListener('change', () => {
      this.previewBranch();
      this.compareBtn.disabled = (this.branchSelector.value === this.currentBranch);
    });

    this.switchBtn.addEventListener('click', () => {this.checkoutBranch()});
    this.compareBtn.addEventListener('click', () => {this.compareBranch()});

    this.toolbarBtns.forEach(btn =>
      btn.addEventListener('click', () => this._onToolbar(btn.dataset.op))
    );

    this.commitMsg.addEventListener('input', () => {
      this.commitBtn.disabled = !this.commitMsg.value.trim();
    });
    this.commitBtn.addEventListener('click', () => {this.commit()});
    if (this.collapseBtn && this.diffPanel) {
      this.collapseBtn.addEventListener('click', () =>
        this.diffPanel.classList.toggle('collapsed')
      );
    }
    this.versionSelector.addEventListener('change', () => {
      this.compareBtn.disabled = false;
      const ref = this.versionSelector.value;
      if (ref) this.loadDiff(ref);
    });
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.tabButtons.forEach(b => b.classList.remove('active'));
        this.overlays.forEach(o => o.classList.remove('active'));
        btn.classList.add('active');
        this.querySelector(`.gd-overlay--${btn.dataset.panel}`)?.classList.add('active');
      });
    });

    // initial load
    Promise.all([this.loadBranches(), this.loadVersions()])
      .then(() => {
        this.loadStatus();
        this.previewBranch();
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

  // show changelog but don’t switch
  async previewBranch() {
    const target = this.branchSelector.value;
    const isCurrent = (target === this.currentBranch);
    try {
      await this.loadDiff(target);
      this.switchBtn.disabled  = isCurrent;
      this.compareBtn.disabled = isCurrent;
    } catch (err) {
      console.error('Preview failed:', err);
      this.showToast(`Error loading changelog: ${err.message}`, true);
    }
  }

  // actually switch branches
  async checkoutBranch() {
    try {
      const branch = this.branchSelector.value;
      await this._api('/api/git/branches/restore', 'POST', { branch });
      this.currentBranch = branch;
      this.currentBranchLabel.textContent = branch;
      this.currentBranchToolbar.textContent = branch;
      this.showToast(`Switched to ${branch}`);
      await this.loadStatus();
      this.previewBranch();
    } catch (err) {
      console.error('Checkout failed:', err);
      this.showToast(`Error switching to ${target}: ${err.message}`, true);
    }
  }

  async compareBranch() {
    console.log('compareBranch');
    // compare HEAD ↔ selected commit (not branch selector)
    const ref = this.versionSelector.value;
    try {
      const { changelog } = await this._api('/api/git/compare', 'POST', { ref });
      console.log("got changelog for", ref);
      // jump back into the Diff tab
      this.tabButtons.forEach(b => {
        if (b.dataset.panel === 'diff') b.click();
      });
      this._renderRawDiff(changelog);
    } catch (err) {
      console.error(err);
      this.showToast(`Compare failed: ${err.message}`, true);
    }
  }

  // helper to switch tabs programmatically
  _activatePanel(panel) {
    // toggle tab buttons
    this.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    });
    // toggle overlay panes
    this.overlays.forEach(overlay => {
      const isMatch = overlay.classList.contains(`gd-overlay--${panel}`);
      overlay.classList.toggle('active', isMatch);
    });
  }

  
  _renderRawDiff(changelog) {
    const fileMap = new Map();
    let currentFile = null, buffer = [];
  
    changelog.split('\n').forEach(line => {
      if (line.startsWith('diff --git ')) {
        if (currentFile) {
          fileMap.set(
            currentFile,
            (fileMap.get(currentFile) || '') + buffer.join('\n') + '\n'
          );
        }
        const parts = line.split(' ');
        currentFile = parts[3].slice(2);
        buffer = [line];
      } else if (currentFile) {
        buffer.push(line);
      }
    });
    if (currentFile) {
      fileMap.set(
        currentFile,
        (fileMap.get(currentFile) || '') + buffer.join('\n') + '\n'
      );
    }
  
    // rebuild tabs
    this.diffTabs.innerHTML = '';
    this._diffByFile = {};
    Array.from(fileMap.entries()).forEach(([fn, content], idx) => {
      this._diffByFile[fn] = content;
      const tab = document.createElement('button');
      tab.textContent = fn;
      tab.classList.add('gd-diff-tab');
      if (!idx) tab.classList.add('active');
      tab.addEventListener('click', () => this._showDiffFile(fn));
      this.diffTabs.append(tab);
    });
  
    // show first
    if (fileMap.size) {
      this._showDiffFile(this.diffTabs.firstChild.textContent);
    } else {
      this.diffContent.textContent = '(no changes)';
    }
  }

  /**
   * Roll back current branch by one commit, then refresh UI.
   */
  async rollbackOne() {
    if (!confirm('Are you sure you want to roll back the last commit on this branch?')) return;
    try {
      const { message } = await this._api('/api/git/rollback-one', 'POST');
      this.showToast(message);
      // refresh everything:
      await Promise.all([
        this.loadBranches(),
        this.loadStatus(),
        this.loadVersions()
      ]);
      this.previewBranch();
    } catch (err) {
      console.error('Rollback failed:', err);
      this.showToast(`Rollback failed: ${err.message}`, true);
    }
  }
  
  // populate and enable the versions dropdown
  async loadVersions() {
    const { versions } = await this._api('/api/git/versions', 'POST', { maxCount: 50 });
    this.versionSelector.innerHTML = versions
      .map(line => {
        const [sha, ...msg] = line.split(' ');
        return `<option value="${sha}">${line}</option>`;
      })
      .join('');
    this.versionSelector.disabled = false;            // <-- enable it now
    if (versions.length) {
      const firstSha = versions[0].split(' ')[0];
      this.versionSelector.value = firstSha;
      this.loadDiff(firstSha);
    }
  }

  async loadDiff(ref) {
    const { changelog } = await this._api('/api/git/changelog', 'POST', { ref });
    this._renderRawDiff(changelog);
  }
  
  _showDiffFile(filename) {
    // highlight active tab (unchanged) …
    // now render with color spans:
    const raw = this._diffByFile[filename] || '';
    // escape HTML
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;');
    // wrap + / - lines
    const html = escaped
      .replace(/^(\+.*)$/gm, '<span class="gd-added">$1</span>')
      .replace(/^(-.*)$/gm, '<span class="gd-removed">$1</span>');
    this.diffContent.innerHTML = html;
  }
  
  
  async loadBranches() {
    const { branches } = await this._api('/api/git/branches', 'GET');
    this.branchSelector.innerHTML = branches.map(b => `<option>${b}</option>`).join('');
  
    const { branch } = await this._api('/api/git/current-branch', 'GET');
    this.currentBranch = branch;
    this.branchSelector.value = branch;
    // update both places
    this.currentBranchLabel.textContent = branch;
    this.currentBranchToolbar.textContent = branch;
  }

  async loadStatus() {
    const { unstaged, staged } = await this._api('/api/git/status', 'GET');
    this._renderList(this.unstagedList, unstaged, false);
    this._renderList(this.stagedList, staged, true);
  }

  _renderList(container, files, isStaged) {
    container.innerHTML = '';
    files.forEach(f => {
      const li = document.createElement('li');
      li.dataset.file = f;
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

  async commit() {
    const msg = this.commitMsg.value.trim();
    if (!msg) return;
    await this._api('/api/git/commit', 'POST', { message: msg });
    this.commitMsg.value = '';
    this.showToast(`Committed to ${this.currentBranch}`);
    this.loadStatus();
  }

  async stageAll() {
    const files = Array.from(this.unstagedList.querySelectorAll('li'))
                       .map(li => li.dataset.file);
    if (!files.length) return;
    await this._api('/api/git/stage', 'POST', { files });
    this.loadStatus();
  }

  async unstageAll() {
    const files = Array.from(this.stagedList.querySelectorAll('li'))
                       .map(li => li.dataset.file);
    if (!files.length) return;
    await this._api('/api/git/unstage', 'POST', { files });
    this.loadStatus();
  }

  async fetchAll() { await this._api('/api/git/fetch-all', 'POST'); this.showToast('Fetched all remotes'); }
  async pull() { await this._api('/api/git/branches/pull', 'POST', { branch: this.currentBranch }); this.showToast('Pulled latest'); this.loadStatus(); }
  async push() { await this._api('/api/git/branches/push', 'POST', { branch: this.currentBranch }); this.showToast('Pushed to remote'); }
  async hardReset() { const ref = prompt('Reset to commit (SHA or ref):', 'HEAD'); if (ref) { await this._api('/api/git/hard-reset', 'POST', { commit: ref }); this.showToast(`Hard reset to ${ref}`); this.loadStatus(); } }
  async newBranch() { const name = prompt('New branch name:'); if (name) { await this._api('/api/git/branches', 'POST', { branch: name }); this.loadBranches(); this.showToast(`Branch ${name} created`); } }
  async deleteBranch() { if (confirm(`Delete branch ${this.currentBranch}?`)) { await this._api('/api/git/branches/delete', 'POST', { branch: this.currentBranch }); this.currentBranch = ''; this.commitBtn.disabled = true; this.showToast('Branch deleted'); await this.loadBranches(); this.loadStatus(); } }
  async stash() { const { message } = await this._api('/api/git/stash', 'POST'); this.showToast(message); this.loadStatus(); }
  async applyStash() { const ref = prompt('Stash ref to apply:', 'stash@{0}'); if (ref) { const { message } = await this._api('/api/git/apply-stash', 'POST', { stashRef: ref }); this.showToast(message); this.loadStatus(); } }
  async dropStash() { const ref = prompt('Stash ref to drop:', 'stash@{0}'); if (ref) { const { message } = await this._api('/api/git/drop-stash', 'POST', { stashRef: ref }); this.showToast(message); } }
  async clean() { if (confirm('Clean untracked files and dirs?')) { await this._api('/api/git/clean', 'POST'); this.showToast('Working directory cleaned'); this.loadStatus(); } }
  async removeRepo() { if (confirm('Remove .git and start fresh?')) { await this._api('/api/git/remove-local-repo', 'POST'); this.showToast('Local Git repo removed'); await this.loadBranches(); this.loadStatus(); } }

  _onToolbar(op) {
    return this[op.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]();
  }

  showToast(msg, isError = false) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.toggle('error', isError);
    this.toastEl.hidden = false;
    setTimeout(() => this.toastEl.hidden = true, 3000);
  }
}

customElements.define('git-desktop', GitDesktop);
