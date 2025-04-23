// index.js

import './gpt_dev.css';
const API_BASE = 'http://localhost:3000';

const template = document.createElement('template');
template.innerHTML = `
  <div class="gpt-container">
    <div class="thread-sidebar">
      <div class="sidebar-header">
        <span>Chats</span>
        <button class="new-chat-btn" title="New Chat">＋</button>
      </div>
      <input class="thread-name-sidebar" type="text" placeholder="Conversation title"/>
      <ul class="thread-list"></ul>
    </div>
    <div class="chat-main">
      <div class="gpt-chat-header">
        <h2 class="chat-title">Select or create a chat →</h2>
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

// —————— capture console (limit to last 100 entries) ——————
window.__consoleHistory__ = [];
['log', 'info', 'warn', 'error'].forEach(level => {
  const orig = console[level];
  console[level] = (...args) => {
    // record entry
    window.__consoleHistory__.push({
      level,
      timestamp: new Date().toISOString(),
      args: args.map(a =>
        typeof a === 'string' ? a : JSON.stringify(a)
      )
    });
    // trim history to last 100
    if (window.__consoleHistory__.length > 100) {
      window.__consoleHistory__.shift();
    }
    // call original
    orig.apply(console, args);
  };
});

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

    // sidebar
    this.threadList    = this.querySelector('.thread-list');
    this.newChatBtn    = this.querySelector('.new-chat-btn');
    this.threadNameSidebar = this.querySelector('.thread-name-sidebar');

    this.threadNameSidebar.style.display = 'none';        // hide by default
    // chat area
    this.chatTitleEl   = this.querySelector('.chat-title');
    this.threadNameInput = this.querySelector('.thread-name');
    this.deleteChatBtn   = this.querySelector('.delete-chat-btn');
    this.viewFilesBtn    = this.querySelector('.view-files-btn');
    this.chatMessages    = this.querySelector('.gpt-chat-messages');
    this.form            = this.querySelector('.gpt-chat-form');
    this.input           = this.form.querySelector('input');
    this.sendBtn         = this.form.querySelector('button');

    // event wiring
    this.newChatBtn.addEventListener('click', () => this._createNewThread());
    this.deleteChatBtn.addEventListener('click', () => this._deleteCurrentThread());
    this.viewFilesBtn.addEventListener('click', () => this._showFileTree());
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      this.sendMessage(this.input.value);
    });

    this._loadThreads();
  }

  async _loadThreads() {
    const res = await fetch(`${API_BASE}/api/threads`);
    if (!res.ok) return;
    this.threads = await res.json();
    // sort by ID or title
    this.threads.sort((a, b) => a.title.localeCompare(b.title));
    this._renderThreadList();

    // auto‐select the most recent if none selected
    if (!this.currentThreadId && this.threads.length) {
      await this._selectThread(this.threads[this.threads.length - 1].id);
    }
  }

  /** helper to toggle the sidebar title‐input */
  _updateThreadNameSidebarVisibility() {
    this.threadNameSidebar.style.display =
    this.currentThreadId === null ? 'block' : 'none';
  }

  _renderThreadList() {
    this.threadList.innerHTML = '';
    this.threads.forEach(({ id, title }) => {
      const li = document.createElement('li');
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
        if (!confirm('Delete this chat?')) return;
        await fetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
        // remove from local list & UI
        this.threads = this.threads.filter(t => t.id !== id);
        if (this.currentThreadId === id) {
          this.currentThreadId = null;
          this.clearChat();
          this.threadNameInput.value = '';
        }
        this._renderThreadList();
      });

      li.append(span, btn);
      this.threadList.append(li);
    });
  }

  async _createNewThread() {
    this.currentThreadId = null;
    this.clearChat();
    this.threadNameSidebar.value = '';
    this._renderThreadList();
    this._updateThreadNameSidebarVisibility();   // <-- show it
  }

  async _selectThread(id) {
    this.currentThreadId = id;
    this._highlightSelectedThread();
    this._updateThreadNameSidebarVisibility();   // <-- hide it

    const res = await fetch(`${API_BASE}/api/threads/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const { title, messages } = await res.json();

    // Update header and sidebar‐input
    this.chatTitleEl.textContent       = title || 'Untitled Chat';
    this.threadNameSidebar.value       = title || '';

    // Render messages in time order
    this.clearChat();
    (messages || [])
      .sort((a, b) => a.created_at - b.created_at)
      .forEach(msg => {
        const ts   = new Date(msg.created_at * 1000).toLocaleString();
        const text = extractContent(msg.content);
        const { wrap } = this.appendMessage(msg.role, text, ts);
        wrap.dataset.msgId = msg.id;
      });

    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }


  async _renameThread() {
    const id = this.currentThreadId;
    const newTitle = this.threadNameInput.value.trim();
    if (!id || !newTitle) return;
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(id)}/title`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      }
    );
    if (!res.ok) return;
    // update local
    this.threads = this.threads.map(t =>
      t.id === id ? { ...t, title: newTitle } : t
    );
    this._renderThreadList();
  }

  async _deleteCurrentThread() {
    const id = this.currentThreadId;
    if (!id || !confirm('Delete this entire chat?')) return;
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) return;
    // refresh
    this.threads = this.threads.filter(t => t.id !== id);
    this.currentThreadId = null;
    this.clearChat();
    this.threadNameInput.value = '';
    this._renderThreadList();
  }

  clearChat() {
    this.chatMessages.innerHTML = '';
  }

  appendMessage(role, text, ts) {
  // Outer wrapper
  const wrap = document.createElement('div');
  wrap.className = `gpt-chat-message ${role}`;

  // Timestamp + author line
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : 'GPT'} • ${ts}`;

  // Bubble content
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  // establish positioning context for the buttons
  content.style.position = 'relative';

  // Only user‐messages get edit/delete buttons
  if (role === 'user') {
    // ✏️ Edit button
    const btnEdit = document.createElement('button');
    btnEdit.className = 'edit-msg-btn';
    btnEdit.textContent = '✏️';
    btnEdit.addEventListener('click', async () => {
      const updated = prompt('Edit your message:', text);
      if (updated == null) return;
      const msgId = wrap.dataset.msgId;
      await fetch(
        `${API_BASE}/api/threads/${encodeURIComponent(this.currentThreadId)}/messages/${msgId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: [{ type: 'text', text: { value: updated, annotations: [] } }],
            metadata: { edited: true }
          })
        }
      );
      content.textContent = updated;
      // move buttons back into the new text node
      content.append(btnEdit, btnDel);
    });

    // 🗑️ Delete button
    const btnDel = document.createElement('button');
    btnDel.className = 'delete-msg-btn';
    btnDel.textContent = '🗑️';
    btnDel.addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      const msgId = wrap.dataset.msgId;
      const resp = await fetch(
        `${API_BASE}/api/threads/${encodeURIComponent(this.currentThreadId)}/messages/${msgId}`,
        { method: 'DELETE' }
      );
      if (resp.ok) wrap.remove();
    });

    // append into the bubble
    content.append(btnEdit, btnDel);
  }

  // build DOM
  wrap.append(meta, content);
  this.chatMessages.appendChild(wrap);

  return { wrap };
}


  _highlightSelectedThread() {
    // toggle 'selected' on every <li> by matching its data-id
    this.threadList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('selected', li.dataset.id === this.currentThreadId);
    });
  }
  
  async sendMessage(prompt) {
    if (!prompt.trim()) return;

    // 1) Echo user
    const userTs = new Date().toLocaleString();
    this.appendMessage('user', prompt, userTs);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // 2) Disable & clear
    this.input.disabled = this.sendBtn.disabled = true;
    this.input.value = '';

    // 3) Dummy placeholder (we'll remove it)
    const placeholder = this.appendMessage('assistant', '…', '');
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // 4) Call the backend
    const payload = {
      prompt,
      threadId: this.currentThreadId,
      ...(this.currentThreadId ? {} : { title: this.threadNameSidebar.value.trim() || undefined })
    };

    let result, threadId, logs;
    try {
      const res = await fetch(`${API_BASE}/api/prompt`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      ({ result, threadId, logs } = await res.json());
    } catch (err) {
      console.error('sendMessage error:', err);
      placeholder.wrap.remove();
      this.input.disabled = this.sendBtn.disabled = false;
      return;
    }

    // 5) Manage thread list & selection
    if (!this.threads.find(t => t.id === threadId)) {
      this.threads.push({ id: threadId, title: this.threadNameSidebar.value.trim() || threadId });
      this._renderThreadList();
    }
    this.currentThreadId = threadId;
    this._highlightSelectedThread();

    // 6) Remove the “…” placeholder
    placeholder.wrap.remove();

    // 7) Render each tool call as two bubbles
    const ts = new Date().toLocaleString();
    if (Array.isArray(logs) && logs.length) {
      for (let i = 0; i < logs.length; i += 2) {
        const callLog   = logs[i];
        const resultLog = logs[i+1];

        // Bubble for the function call
        const callText = `🔧 call ${callLog.name}(${JSON.stringify(callLog.arguments)})`;
        this.appendMessage('assistant', callText, ts);

        // Bubble for the function result
        const resText = `📥 result ${callLog.name}: ${resultLog.result}`;
        this.appendMessage('assistant', resText, ts);
      }
    }

    // 8) Finally, render the actual assistant reply
    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (Array.isArray(result.choices)) {
      text = result.choices.map(c => c.message?.content || c.text || '').join('\n');
    } else if (result?.content) {
      text = extractContent(result.content);
    } else {
      text = JSON.stringify(result, null, 2);
    }
    this.appendMessage('assistant', text, ts);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

    // 9) Re-enable input
    this.input.disabled = this.sendBtn.disabled = false;
    this.input.focus();
  }

  async _showFileTree() {
    const res = await fetch(`${API_BASE}/api/files`);
    if (!res.ok) return;
    const tree = await res.json();
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
  }
}

customElements.define('gpt-chat', GptChat);
document.body.append(document.createElement('gpt-chat'));
