//./gpt_dev/gpt_dev.js
import './gitBrowser'
import './gpt_dev.css';

import { functionCapabilityOverview } from './components/functionsComponent';

import { 
  fetchThreads, fetchThreadById, 
  deleteThreadById, sendPrompt, 
  editMessage, deleteMessageById, 
  fetchFilesTree, API_BASE
} from './frontendUtil';

window.__consoleHistory__ = [];
['log', 'info', 'warn', 'error'].forEach(level => {
  const orig = console[level];
  console[level] = (...args) => {
    window.__consoleHistory__.push({
      level,
      timestamp: new Date().toISOString(),
      args: args.map(a =>
        typeof a === 'string' ? a : JSON.stringify(a)
      )
    });
    if (window.__consoleHistory__.length > 100) {
      window.__consoleHistory__.shift();
    }
    orig.apply(console, args);
  };
});

// ───────────── extractContent ─────────────

function extractContent(contentArray = []) {
  return contentArray
    .map(c => {
      if (!c.text) return '';
      if (typeof c.text === 'string') return c.text;
      if (typeof c.text.value === 'string') return c.text.value;
      return '';
    })
    .join('\n');
}

// ───────────── template ─────────────

const template = document.createElement('template');
template.innerHTML = `
  <div class="gpt-container">
    <div class="thread-sidebar">
      <div class="sidebar-header">
        <span>Chats</span>
        <button class="new-chat-btn" title="New Chat">＋</button>
      </div>
      <input
        class="thread-name-sidebar"
        type="text"
        placeholder="Conversation title…"
      />
      <ul class="thread-list"></ul>
      <button type="button" class="reset-project-btn">Reset Project</button>
    </div>
    <div class="chat-main">
      <div class="gpt-chat-header">
        <h2 class="chat-title">← Select or create a chat</h2>
        <button class="delete-chat-btn" title="Delete Chat">🗑️</button>
        <button class="view-files-btn">View Files</button>
        <button class="capabilities-btn" title="What can I do?">❓</button>
      </div>
      <div class="gpt-chat-messages"></div>
      <form class="gpt-chat-form">
        <textarea type="text" placeholder="Type your message…" autocomplete="off"></textarea>
        <button type="submit">Send</button>
        <button type="button" class="cancel-btn" disabled>Cancel</button>
      </form>
    </div>
  </div>
`;

// ───────────── Custom Element ─────────────

class GptChat extends HTMLElement {
  constructor() {
    super();
    this._init = false;
    this.currentThreadId = null;
    this.threads = [];
  }

  connectedCallback() {
    if (this._init) return;
    this._init = true;
    this.append(template.content.cloneNode(true));
  
    this.threadList        = this.querySelector('.thread-list');
    this.newChatBtn        = this.querySelector('.new-chat-btn');
    this.threadNameSidebar = this.querySelector('.thread-name-sidebar');
    this.chatTitleEl       = this.querySelector('.chat-title');
    this.deleteChatBtn     = this.querySelector('.delete-chat-btn');
    this.viewFilesBtn      = this.querySelector('.view-files-btn');
    this.chatMessages      = this.querySelector('.gpt-chat-messages');
    this.form              = this.querySelector('.gpt-chat-form');
    this.input             = this.form.querySelector('input');
    this.sendBtn           = this.form.querySelector('button[type="submit"]');
    this.cancelBtn         = this.form.querySelector('.cancel-btn');
    this.resetProjectBtn   = this.querySelector('.reset-project-btn');
    this.abortController   = null;
    this.capabilitiesBtn   = this.querySelector('.capabilities-btn');

    this.threadNameSidebar.style.display = 'none';
    this._ensureConfirmModal();
  
    this.newChatBtn.addEventListener('click', () => this._createNewThread());
    this.deleteChatBtn.addEventListener('click', () => this._deleteCurrentThread());
    this.viewFilesBtn.addEventListener('click', () => this._showFileTree());
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      this.sendMessage(this.input.value);
    });
    this.capabilitiesBtn.addEventListener('click', () => this._showCapabilities());

  
    this.cancelBtn.addEventListener('click', async () => {
      if (!this.abortController) return;
      // Abort the in-flight fetch
      this.abortController.abort();
      this.cancelBtn.disabled = true;
      // Tell backend to clear any queued/in-progress runs
      await fetch(`${API_BASE}/api/threads/${this.currentThreadId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    });

    this.resetProjectBtn.addEventListener('click', async () => {
      const ok = await this._confirm(
        'Are you sure? This will wipe and restore default project files.'
      );
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/reset_project`, {
          method: 'POST'
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        // show success notice
        await this._confirm('Project has been reset to defaults.');
      } catch (err) {
        await this._confirm('Failed to reset project: ' + err.message);
      }
    });
  
    this._loadThreads();
  
    this.es = new EventSource(API_BASE + '/events');
    this.es.addEventListener('console', e => {
      const { id } = JSON.parse(e.data);
      fetch(API_BASE + '/api/console_history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, history: window.__consoleHistory__ })
      });
    });
  }

  _updateControls() {
    this.deleteChatBtn.disabled = !this.currentThreadId;
  }

  _showCapabilities() {
    // Prevent multiple instances
    if (document.getElementById('capabilitiesModal')) return;
  
    const modal = document.createElement('div');
    modal.id = 'capabilitiesModal';
    modal.innerHTML = `
      <div class="capabilities-wrapper">
      <button class="close">❌</button><br/>
      </tool-capabilities>
        <tool-capabilities>
      </div>
    `;
    modal.querySelector('.close').onclick = () => modal.remove();
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.remove();
    });
    // Feed the overview data into the component
    modal.querySelector('tool-capabilities').overview = functionCapabilityOverview;
  
    document.body.appendChild(modal);
  }
  
  async _loadThreads() {
    try {
      this.threads = await fetchThreads();
      this.threads.sort((a, b) => a.title.localeCompare(b.title));
      this._renderThreadList();
      if (this.threads.length) {
        await this._selectThread(this.threads[0].id);
      } else {
        this._createNewThread();
      }
    } catch (err) {
      console.error(err);
    }
  }

  _updateThreadNameSidebarVisibility() {
    this.threadNameSidebar.style.display =
      this.currentThreadId === null ? 'block' : 'none';
  }

  _renderThreadList() {
    this.threadList.innerHTML = '';
    this.threads.forEach(({ id, title }) => {
      const li = document.createElement('li');
      li.dataset.id = id;
      li.classList.toggle('selected', id === this.currentThreadId);

      const span = document.createElement('span');
      span.className = 'thread-item-label';
      span.textContent = title || id;
      span.addEventListener('click', () => this._selectThread(id));

      const btn = document.createElement('button');
      btn.className = 'delete-thread-btn';
      btn.textContent = '🗑️';
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!await this._confirm('Delete this chat?')) return;
        await deleteThreadById(id);
        this.threads = this.threads.filter(t => t.id !== id);
        if (this.currentThreadId === id) {
          this.currentThreadId = null;
          this.clearChat();
          this.chatTitleEl.textContent = 'New Chat';
          this._updateThreadNameSidebarVisibility();
          this._updateControls();
        }
        this._renderThreadList();
      });

      li.append(span, btn);
      this.threadList.append(li);
    });
  }

  async _deleteCurrentThread() {
    if (!this.currentThreadId) return;
    if (!await this._confirm('Delete this entire chat?')) return;
    await deleteThreadById(this.currentThreadId);
    this.threads = this.threads.filter(t => t.id !== this.currentThreadId);

    this.currentThreadId = null;
    this.clearChat();
    this.chatTitleEl.textContent = 'New Chat';
    this._renderThreadList();
    this._updateThreadNameSidebarVisibility();
    this._updateControls();
  }

  async _createNewThread() {
    this.currentThreadId = null;
    this.clearChat();
    this.threadNameSidebar.value = '';
    this._renderThreadList();
    this._updateThreadNameSidebarVisibility();
    this.chatTitleEl.textContent = 'New Chat';
    this._updateControls();
    setTimeout(() => this.threadNameSidebar.focus(), 0);
  }

  async _selectThread(id) {
    this.currentThreadId = id;
    this._renderThreadList();
    this._updateThreadNameSidebarVisibility();
    this._updateControls();
    this._ensureEditModal();

    try {
      const { title, messages } = await fetchThreadById(id);
      this.chatTitleEl.textContent = title || 'Untitled Chat';
      this.clearChat();
      (messages || [])
        .sort((a, b) => a.created_at - b.created_at)
        .forEach(msg => {
          const ts = new Date(msg.created_at * 1000).toLocaleString();
          const text = extractContent(msg.content);
          const { wrap } = this.appendMessage(msg.role, text, ts);
          wrap.dataset.msgId = msg.id;
        });
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    } catch (err) {
      console.error(err);
    }
  }

  clearChat() {
    this.chatMessages.innerHTML = '';
  }

  // ───────────── Confirm Modal ─────────────
  _ensureConfirmModal() {
    if (document.getElementById('confirmModal')) return;
    const modal = document.createElement('div');
    modal.id = 'confirmModal';
    modal.innerHTML = `
      <div class="modal-content">
        <p class="modal-message"></p>
        <div class="modal-buttons">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-ok">OK</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('visible');
    });
    modal.querySelector('.btn-cancel').addEventListener('click', () => {
      modal._resolve(false);
      modal.classList.remove('visible');
    });
    modal.querySelector('.btn-ok').addEventListener('click', () => {
      modal._resolve(true);
      modal.classList.remove('visible');
    });
    document.body.appendChild(modal);
  }

  _confirm(message) {
    const modal = document.getElementById('confirmModal');
    modal.querySelector('.modal-message').textContent = message;
    modal.classList.add('visible');
    return new Promise(resolve => (modal._resolve = resolve));
  }

  // ───────────── Edit Modal ─────────────
  _ensureEditModal() {
    let modal = document.getElementById('editModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'editModal';
    modal.innerHTML = `
      <div class="modal-content">
        <textarea class="modal-textarea"></textarea>
        <div class="modal-buttons">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-ok">OK</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('visible');
    });

    const textarea = modal.querySelector('.modal-textarea');
    modal.querySelector('.btn-cancel').addEventListener('click', () => {
      modal._resolve(null);
      modal.classList.remove('visible');
    });
    modal.querySelector('.btn-ok').addEventListener('click', () => {
      modal._resolve(textarea.value);
      modal.classList.remove('visible');
    });

    document.body.appendChild(modal);
    return modal;
  }

  _edit(initialText = '') {
    // always have the modal in the DOM
    const modal = document.getElementById('editModal') || this._ensureEditModal();
    const textarea = modal.querySelector('.modal-textarea');
    textarea.value = initialText;
    modal.classList.add('visible');
    textarea.focus();
    return new Promise(resolve => (modal._resolve = resolve));
  }

  // ───────────── Message Rendering ─────────────
  appendMessage(role, text, ts) {
    const wrap = document.createElement('div');
    wrap.className = `gpt-chat-message ${role}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${
      role === 'user' ? 'You' :
      role === 'tool' ? '🔧 Tool' :
      'GPT'
    } • ${ts}`;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;

    wrap.append(meta, content);

    // only allow edits/deletes on user‐sent messages
    if (role === 'user') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      // edit button
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-msg-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit message';
      editBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const msgId = wrap.dataset.msgId;
        if (!msgId) return;
        const newText = await this._edit(content.textContent);
        if (newText != null && newText.trim() !== '') {
          try {
            await editMessage(this.currentThreadId, msgId, { content: newText });
            content.textContent = newText;
          } catch (err) {
            // reuse confirm modal for errors
            await this._confirm('Error editing: ' + err.message);
          }
        }
      });

      // delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-msg-btn';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!wrap.dataset.msgId) return;
        if (!await this._confirm('Delete this message?')) return;
        try {
          await deleteMessageById(this.currentThreadId, wrap.dataset.msgId);
          wrap.remove();
        } catch (err) {
          await this._confirm('Error deleting: ' + err.message);
        }
      });

      actions.append(editBtn, deleteBtn);
      wrap.append(actions);
    }

    this.chatMessages.appendChild(wrap);
    return { wrap };
  }

  appendToolEntry(entry) {
    const ts = new Date().toLocaleTimeString();
    if (entry.type === 'function_call') {
      const args = JSON.stringify(entry.arguments);
      this.appendMessage(
        'tool',
        `🛠️ ${entry.name}(${args})`,
        ts
      );
    } else if (entry.type === 'function_result') {
      this.appendMessage(
        'tool',
        `✅ ${entry.name} → ${entry.result}`,
        ts
      );
    }
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  async sendMessage(prompt) {
    if (!prompt.trim()) return;
  
    // 1) Set up AbortController & enable Cancel button
    this.abortController = new AbortController();
    this.cancelBtn.disabled = false;
  
    // 2) Show typing indicator
    const loading = document.createElement('div');
    loading.className = 'typing-indicator';
    loading.innerHTML = '<span></span><span></span><span></span>';
    this.chatMessages.appendChild(loading);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  
    // 3) Echo user message
    const userTs = new Date().toLocaleString();
    const { wrap: userWrap } = this.appendMessage('user', prompt, userTs);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  
    // 4) Disable input while waiting
    this.input.disabled = this.sendBtn.disabled = true;
    this.input.value = '';
  
    // 5) Add placeholder for assistant
    const { wrap: placeholderWrap } = this.appendMessage('assistant', '…', '');
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  
    const payload = {
      prompt,
      threadId: this.currentThreadId,
      ...(this.currentThreadId ? {} : { title: this.threadNameSidebar.value.trim() })
    };
  
    let json;
    try {
      // pass the signal so we can abort
      json = await sendPrompt(payload, this.abortController.signal);
    } catch (err) {
      // Clean up UI
      placeholderWrap.remove();
      loading.remove();
      this.input.disabled = this.sendBtn.disabled = false;
      this.cancelBtn.disabled = true;
  
      const ts = new Date().toLocaleString();
      if (err.name === 'AbortError') {
        this.appendMessage('assistant', '⚠️ Cancelled by user', ts);
      } else {
        this.appendMessage('assistant', `❌ Network Error: ${err.message}`, ts);
      }
      return;
    }
  
    const {
      error,
      errorMessage,
      logs,
      result,
      threadId,
      userMessageId,
      assistantMessageId
    } = json;
  
    // 6) Render any tool logs
    logs.forEach(entry => {
      if (entry.type === 'retry') {
        this.appendMessage(
          'tool',
          `🔄 Retry attempt ${entry.attempt}: ${entry.error}`,
          new Date().toLocaleTimeString()
        );
      } else {
        this.appendToolEntry(entry);
      }
    });
  
    // 7) Re-enable input
    this.input.disabled = this.sendBtn.disabled = false;
    this.input.focus();
  
    // 8) Handle server-reported error
    if (error) {
      const ts2 = new Date().toLocaleString();
      this.appendMessage('assistant', `❌ Error: ${errorMessage}`, ts2);
      this.cancelBtn.disabled = true;
      return;
    }
  
    // 9) On success, replace placeholder & show assistant reply
    placeholderWrap.remove();
    loading.remove();
  
    userWrap.dataset.msgId = userMessageId;
    const ts3 = new Date().toLocaleTimeString();
    const content = typeof result === 'string'
      ? result
      : extractContent(result.content || []);
    const { wrap: asstWrap } = this.appendMessage('assistant', content, ts3);
    asstWrap.dataset.msgId = assistantMessageId;
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  
    // 10) Disable Cancel now that we're done
    this.cancelBtn.disabled = true;
  
    // 11) Thread bookkeeping (as before)
    if (!this.threads.find(t => t.id === threadId)) {
      this.threads.push({
        id: threadId,
        title: this.threadNameSidebar.value.trim() || threadId
      });
      this._renderThreadList();
    }
    this.currentThreadId = threadId;
    this._highlightSelectedThread();
    this._updateThreadNameSidebarVisibility();
    const th = this.threads.find(t => t.id === threadId);
    this.chatTitleEl.textContent = th.title || 'Untitled Chat';
  }

  _highlightSelectedThread() {
    this.threadList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.id === this.currentThreadId);
    });
  }

  async _showFileTree() {
    try {
      const tree = await fetchFilesTree();

      const modal = document.createElement('div');
      modal.id = 'fileModal';
      modal.innerHTML = `
        <button class="close">✖</button>
        <div class="file-git-container">
          <div class="file-tree-panel">
            <h3>Files</h3>
            <ul class="file-tree-root"></ul>
          </div>
          <div class="git-browser-panel">
            <h3>Git Browser</h3>
            <git-desktop></git-desktop>
          </div>
        </div>
      `;
      modal.querySelector('.close').onclick = () => modal.remove();

      // ───────────── recursive renderer ─────────────
      function render(node) {
        const li = document.createElement('li');

        // ── FOLDER ──
        if (Array.isArray(node.children)) {
          const span = document.createElement('span');
          span.textContent = node.name;
          span.classList.add('file-node', 'collapsed');   // ← restored
          span.onclick = () => span.classList.toggle('collapsed');
          li.append(span);

          const ul = document.createElement('ul');
          node.children.forEach(child => ul.append(render(child)));
          li.append(ul);
        }

        // ── FILE ──
        else {
          const span = document.createElement('span');
          span.textContent = node.name;
          span.classList.add('file-leaf');                // ← restored

          // add extension-specific class (.js, .css, .html, …) for colour-coding
          const ext = node.name.match(/\.([^.]+)$/);
          if (ext) span.classList.add(ext[1]);

          li.append(span);
        }

        return li;
      }

      const treeRoot = modal.querySelector('.file-tree-root');
      tree.forEach(node => treeRoot.append(render(node)));
    
      document.body.append(modal);
    } catch (err) {
      console.error(err);
    }
  }
}

customElements.define('gpt-chat', GptChat);
document.body.append(document.createElement('gpt-chat'));
