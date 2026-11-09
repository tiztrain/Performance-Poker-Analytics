import { parseAll } from './engine/parser.js';
import { countNew, handsFromRecords, recordsFromText } from './engine/history.js';
import { createHistoryStore } from './render/historyStore.js';
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

// ---------- Analyze, with saved history ----------
// Every analyzed upload is saved in this browser (IndexedDB) and merged with what was saved
// before, so stats cover all your sessions. Hands are keyed by hand ID, so loading the same file
// twice changes nothing. The built-in sample is shown on its own and never saved.
const history = createHistoryStore();
const resultsEl = document.getElementById('results');
const emptyResultsHtml = resultsEl.innerHTML;

function showParseError(message) {
  resultsEl.innerHTML =
    '<div class="panel"><div class="flag-note">Parsing error: ' +
    message +
    '. This format may differ slightly from what the parser expects — paste a small sample and we can adjust it.</div></div>';
}

document.getElementById('analyze-btn').addEventListener('click', async () => {
  const text = document.getElementById('hh-input').value.trim();
  if (!text) return;
  try {
    if (text === SAMPLE.trim()) {
      const hands = parseAll(text);
      renderResults(hands);
      collapseLoadPanel(`${hands.length} sample hands (not saved to your history)`);
      return;
    }
    const records = recordsFromText(text);
    if (!records.length) {
      showParseError('no hands starting "CoinPoker Hand #" with a hand number were found');
      return;
    }
    const added = countNew(await history.ids(), records);
    await history.putMany(records);
    showHistory(`${added} new hand${added === 1 ? '' : 's'} added. `);
  } catch (e) {
    showParseError(e.message);
  }
});

async function showHistory(prefix = '') {
  const hands = handsFromRecords(await history.all());
  if (!hands.length) return false;
  renderResults(hands);
  const tournaments = groupByTournament(hands).length;
  const where = (await history.persistent()) ? 'saved in this browser' : 'kept for this visit only';
  collapseLoadPanel(
    prefix +
      `${hands.length} hand${hands.length === 1 ? '' : 's'} from ${tournaments} tournament` +
      `${tournaments === 1 ? '' : 's'}, ${where}.`,
  );
  clearHistoryBtn.hidden = false;
  return true;
}

// ---------- Collapsible load panel ----------
// After a successful analysis the load panel shrinks to a one-line summary, so the results get
// the page. The button reopens it to add more hands.
const loadSummary = document.getElementById('load-summary');
const loadBody = document.getElementById('load-body');
const loadToggle = document.getElementById('load-toggle');
const clearHistoryBtn = document.getElementById('clear-history');

function setLoadPanelOpen(open) {
  loadBody.hidden = !open;
  loadToggle.textContent = open ? 'Hide' : 'Add more hands';
  loadToggle.setAttribute('aria-expanded', String(open));
}

function collapseLoadPanel(summary) {
  document.getElementById('load-summary-text').textContent = summary;
  loadSummary.hidden = false;
  clearHistoryBtn.hidden = true;
  setLoadPanelOpen(false);
}

loadToggle.addEventListener('click', () => setLoadPanelOpen(loadBody.hidden));

clearHistoryBtn.addEventListener('click', async () => {
  if (!window.confirm('Delete every hand saved in this browser? Your hand-history files are not affected.')) return;
  await history.clear();
  resultsEl.innerHTML = emptyResultsHtml;
  loadSummary.hidden = true;
  setLoadPanelOpen(true);
});

// Open straight into the saved history, if there is one.
showHistory();
