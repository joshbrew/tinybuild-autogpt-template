// index.js

import './gpt_dev.css';
const API_BASE = 'http://localhost:3000';

// ───────────── Network helpers ─────────────

async function fetchThreads() {
  const res = await fetch(`${API_BASE}/api/threads`);
  if (!res.ok) throw new Error('Failed to load threads');
  return res.json();
}

async function fetchThreadById(id) {
  const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load thread ${id}`);
  return res.json(); // expects { title, messages }
}

async function deleteThreadById(id) {
  return fetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

async function sendPrompt(payload) {
  const res = await fetch(`${API_BASE}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function editMessage(threadId, msgId, contentPayload) {
  return fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(msgId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contentPayload)
    }
  );
}

async function deleteMessageById(threadId, msgId) {
  return fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(msgId)}`,
    { method: 'DELETE' }
  );
}

async function fetchFilesTree() {
  const res = await fetch(`${API_BASE}/api/files`);
  if (!res.ok) throw new Error('Failed to load files');
  return res.json();
}

// ───────────── capture console (limit to last 100 entries) ─────────────

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
    </div>
    <div class="chat-main">
      <div class="gpt-chat-header">
        <h2 class="chat-title">← Select or create a chat</h2>
        <button class="delete-chat-btn" title="Delete Chat">🗑️</button>
        <button class="view-files-btn">View Files</button>
      </div>
      <div class="gpt-chat-messages"></div>
      <form class="gpt-chat-form">
        <input type="text" placeholder="Type your message…" autocomplete="off"/>
        <button type="submit">Send</button>
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
    this.sendBtn           = this.form.querySelector('button');

    this.threadNameSidebar.style.display = 'none';
    this._ensureConfirmModal();

    this.newChatBtn.addEventListener('click', () => this._createNewThread());
    this.deleteChatBtn.addEventListener('click', () => this._deleteCurrentThread());
    this.viewFilesBtn.addEventListener('click', () => this._showFileTree());
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      this.sendMessage(this.input.value);
    });

    this._loadThreads();
  }

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
    document.body.append(modal);
  }

  _confirm(message) {
    const modal = document.getElementById('confirmModal');
    modal.querySelector('.modal-message').textContent = message;
    modal.classList.add('visible');
    return new Promise(resolve => (modal._resolve = resolve));
  }

  _updateControls() {
    const has = !!this.currentThreadId;
    this.deleteChatBtn.disabled = !has;
  }

  async _loadThreads() {
    try {
      this.threads = await fetchThreads();
      this.threads.sort((a, b) => a.title.localeCompare(b.title));
      this._renderThreadList();
      if (this.threads.length) {
        await this._selectThread(this.threads[this.threads.length - 1].id);
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
      btn.title = 'Delete Chat';
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

  appendMessage(role, text, ts) {
    const wrap = document.createElement('div');
    wrap.className = `gpt-chat-message ${role}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${role === 'user' ? 'You' : 'GPT'} • ${ts}`;

    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;

    if (role === 'user') {
      const btnEdit = document.createElement('button');
      btnEdit.className = 'edit-msg-btn';
      btnEdit.textContent = '✏️';
      btnEdit.addEventListener('click', async () => {
        const updated = prompt('Edit your message:', text);
        if (updated == null) return;
        const msgId = wrap.dataset.msgId;
        await editMessage(this.currentThreadId, msgId, {
          content: [{ type: 'text', text: { value: updated, annotations: [] } }],
          metadata: { edited: true }
        });
        content.textContent = updated;
      });

      const btnDel = document.createElement('button');
      btnDel.className = 'delete-msg-btn';
      btnDel.textContent = '🗑️';
      btnDel.addEventListener('click', async () => {
        if (!await this._confirm('Delete this message?')) return;
        const msgId = wrap.dataset.msgId;
        const resp = await deleteMessageById(this.currentThreadId, msgId);
        if (resp.ok) wrap.remove();
      });

      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.append(btnEdit, btnDel);
      wrap.append(actions);
    }

    wrap.append(meta, content);
    this.chatMessages.appendChild(wrap);
    return { wrap };
  }

  _highlightSelectedThread() {
    this.threadList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.id === this.currentThreadId);
    });
  }

  async sendMessage(prompt) {
    if (!prompt.trim()) return;

    const typingEl = document.createElement('div');
    typingEl.className = 'typing-indicator';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    this.chatMessages.appendChild(typingEl);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    const userTs = new Date().toLocaleString();
    const { wrap: userWrap } = this.appendMessage('user', prompt, userTs);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    this.input.disabled = this.sendBtn.disabled = true;
    this.input.value = '';

    const { wrap: placeholderWrap } = this.appendMessage('assistant', '…', '');
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    const payload = {
      prompt,
      threadId: this.currentThreadId,
      ...(this.currentThreadId ? {} : { title: this.threadNameSidebar.value.trim() })
    };

    let json;
    try {
      json = await sendPrompt(payload);
    } catch (err) {
      console.error('sendMessage error:', err);
      placeholderWrap.remove();
      typingEl.remove();
      this.input.disabled = this.sendBtn.disabled = false;
      return;
    }

    const {
      result,
      threadId,
      logs,
      userMessageId,
      assistantMessageId
    } = json;

    userWrap.dataset.msgId = userMessageId;
    placeholderWrap.dataset.msgId = assistantMessageId;

    placeholderWrap.remove();
    typingEl.remove();

    const ts = new Date().toLocaleString();
    const text = typeof result === 'string'
      ? result
      : (Array.isArray(result.choices)
          ? result.choices.map(c => c.message?.content || c.text).join('\n')
          : extractContent(result.content || []));
    const { wrap: assistantWrap } = this.appendMessage('assistant', text, ts);
    assistantWrap.dataset.msgId = assistantMessageId;
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    this.input.disabled = this.sendBtn.disabled = false;
    this.input.focus();

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

  async _showFileTree() {
    try {
      const tree = await fetchFilesTree();
      const modal = document.createElement('div');
      modal.id = 'fileModal';
      modal.innerHTML = '<button class="close">✖</button>';
      modal.querySelector('.close').onclick = () => modal.remove();

      function render(node) {
        const li = document.createElement('li');
        if (Array.isArray(node.children)) {
          const span = document.createElement('span');
          span.textContent = node.name;
          span.classList.add('file-node', 'collapsed');
          span.onclick = () => span.classList.toggle('collapsed');
          li.append(span);
          const ul = document.createElement('ul');
          node.children.forEach(ch => ul.append(render(ch)));
          li.append(ul);
        } else {
          const span = document.createElement('span');
          span.textContent = node.name;
          span.classList.add('file-leaf');
          const ext = node.name.split('.').pop();
          if (ext) span.classList.add(ext.toLowerCase());
          li.append(span);
        }
        return li;
      }

      const ul = document.createElement('ul');
      tree.forEach(n => ul.append(render(n)));
      modal.append(ul);
      document.body.append(modal);
    } catch (err) {
      console.error(err);
    }
  }
}

customElements.define('gpt-chat', GptChat);
document.body.append(document.createElement('gpt-chat'));
