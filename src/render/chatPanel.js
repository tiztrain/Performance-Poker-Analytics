// ---------- "Discuss with Claude" chat panel ----------
// A side panel for talking a hand through with Claude, inside the app. The hand text is the same
// as Copy for Claude (opponents anonymised); it is sent with each message to our own chat API
// (backend/chat), which holds the API key, checks your login and enforces the daily limits and
// monthly budget. Shown only when the site is built with VITE_CHAT_API_URL and login is on.
// The conversation lives only in this panel; it isn't saved.

import { accessToken, authEnabled, login } from '../auth/session.js';

const API = import.meta.env.VITE_CHAT_API_URL || '';
export const chatEnabled = Boolean(API && authEnabled);

const STARTER = 'Review my decisions in this hand.';

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// Plain text to safe HTML paragraphs (the reply is never inserted as HTML).
function paragraphs(text) {
  return text
    .split(/\n{2,}/)
    .map(p => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>')
    .join('');
}

export function chatButtonHtml() {
  return chatEnabled ? '<button class="chat-btn" type="button">Discuss with Claude</button>' : '';
}

// Binds the first .chat-btn inside `container`; getContext returns the hand text when clicked.
export function bindChatButton(container, getContext, title) {
  const btn = container && container.querySelector('.chat-btn');
  if (!btn) return;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openChat({ context: getContext(), title });
  });
}

let panel = null;

export function openChat({ context, title }) {
  if (panel) panel.remove();
  const messages = [];
  let busy = false;
  panel = document.createElement('div');
  panel.className = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Discuss with Claude');
  panel.innerHTML =
    '<div class="chat-head"><b>Discuss with Claude</b><span class="chat-title">' +
    escapeHtml(title || '') +
    '</span><button class="chat-close" type="button" aria-label="Close">×</button></div>' +
    '<div class="chat-log" aria-live="polite"></div><div class="chat-status"></div>' +
    '<form class="chat-form"><textarea class="chat-input" rows="3"></textarea>' +
    '<button class="primary chat-send" type="submit">Send</button></form>';
  document.body.appendChild(panel);
  const log = panel.querySelector('.chat-log');
  const status = panel.querySelector('.chat-status');
  const input = panel.querySelector('.chat-input');
  const send = panel.querySelector('.chat-send');
  panel.querySelector('.chat-close').addEventListener('click', () => {
    panel.remove();
    panel = null;
  });

  if (!accessToken()) {
    log.innerHTML =
      '<div class="chat-msg note">Sign in to discuss hands with Claude. Free accounts get a few messages a day.</div>' +
      '<button class="account-btn chat-signin" type="button">Sign in</button>';
    panel.querySelector('.chat-signin').addEventListener('click', login);
    panel.querySelector('.chat-form').hidden = true;
    return;
  }
  input.value = STARTER;
  input.focus();

  function draw() {
    log.innerHTML = messages
      .map(m => '<div class="chat-msg ' + m.role + '">' + paragraphs(m.content) + '</div>')
      .join('');
    log.scrollTop = log.scrollHeight;
  }

  panel.querySelector('.chat-form').addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    const token = accessToken();
    if (!token) {
      status.textContent = 'Your sign-in has expired. Sign in again to keep chatting.';
      return;
    }
    messages.push({ role: 'user', content: text });
    input.value = '';
    draw();
    busy = true;
    send.disabled = true;
    status.textContent = 'Claude is thinking…';
    try {
      const res = await fetch(API.replace(/\/$/, '') + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ context, messages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        messages.pop(); // not answered, so not part of the conversation
        input.value = text;
        status.textContent = data.error || 'The chat failed (' + res.status + '). Try again.';
      } else {
        messages.push({ role: 'assistant', content: data.reply });
        status.textContent =
          data.remainingToday !== undefined
            ? data.remainingToday + ' message' + (data.remainingToday === 1 ? '' : 's') + ' left today'
            : '';
      }
    } catch {
      messages.pop();
      input.value = text;
      status.textContent = 'Couldn’t reach the chat. Check your connection and try again.';
    }
    busy = false;
    send.disabled = false;
    draw();
  });
}
