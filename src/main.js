import { parseAll } from './engine/parser.js';
import { groupByTournament } from './engine/grouping.js';
import { renderResults } from './render/results.js';
import { SAMPLE } from './sample-hand.js';
import { displayMode, currentRerender, setDisplayMode } from './state.js';
import { authEnabled, completeLoginIfRedirected, currentUser, login, logout, signup } from './auth/session.js';
import { renderAccount } from './render/account.js';

// ---------- Optional login ----------
// Hidden entirely when the build has no Cognito settings (see .env.example).
async function initAccount() {
  if (!authEnabled) return;
  const el = document.getElementById('account');
  const error = await completeLoginIfRedirected();
  renderAccount(el, { user: currentUser(), error, onLogin: login, onSignup: signup, onLogout: logout });
  el.hidden = false;
}
initAccount();

document.getElementById('load-sample').addEventListener('click', () => {
  document.getElementById('hh-input').value = SAMPLE;
});

// ---------- File upload / drag-drop (mobile-friendly input path) ----------
async function loadFilesIntoTextarea(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const texts = await Promise.all(files.map(f => f.text()));
  document.getElementById('hh-input').value = texts.join('\n\n');
  document.getElementById('analyze-btn').click();
}

document.getElementById('hh-file').addEventListener('change', e => {
  loadFilesIntoTextarea(e.target.files);
  e.target.value = '';
});

const taEl = document.getElementById('hh-input');
taEl.addEventListener('dragover', e => {
  e.preventDefault();
  taEl.classList.add('drag-over');
});
taEl.addEventListener('dragleave', () => {
  taEl.classList.remove('drag-over');
});
taEl.addEventListener('drop', e => {
  e.preventDefault();
  taEl.classList.remove('drag-over');
  loadFilesIntoTextarea(e.dataTransfer.files);
});

document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === displayMode) return;
    setDisplayMode(btn.dataset.mode);
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b === btn));
    if (currentRerender) currentRerender();
  });
});

document.getElementById('analyze-btn').addEventListener('click', () => {
  const text = document.getElementById('hh-input').value.trim();
  if (!text) return;
  try {
    const hands = parseAll(text);
    renderResults(hands);
    collapseLoadPanel(hands);
  } catch (e) {
    document.getElementById('results').innerHTML =
      '<div class="panel"><div class="flag-note">Parsing error: ' +
      e.message +
      '. This format may differ slightly from what the parser expects — paste a small sample and we can adjust it.</div></div>';
  }
});

// ---------- Collapsible load panel ----------
// After a successful analysis the load panel shrinks to a one-line summary, so the results get
// the page. The button reopens it to load different hands.
const loadSummary = document.getElementById('load-summary');
const loadBody = document.getElementById('load-body');
const loadToggle = document.getElementById('load-toggle');

function setLoadPanelOpen(open) {
  loadBody.hidden = !open;
  loadToggle.textContent = open ? 'Hide' : 'Load different hands';
  loadToggle.setAttribute('aria-expanded', String(open));
}

function collapseLoadPanel(hands) {
  const tournaments = groupByTournament(hands).length;
  document.getElementById('load-summary-text').textContent =
    `${hands.length} hand${hands.length === 1 ? '' : 's'} loaded from ` +
    `${tournaments} tournament${tournaments === 1 ? '' : 's'}`;
  loadSummary.hidden = false;
  setLoadPanelOpen(false);
}

loadToggle.addEventListener('click', () => setLoadPanelOpen(loadBody.hidden));
