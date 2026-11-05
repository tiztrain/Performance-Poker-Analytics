import { parseAll } from './engine/parser.js';
import { renderResults } from './render/results.js';
import { SAMPLE } from './sample-hand.js';
import { displayMode, currentRerender, setDisplayMode } from './state.js';

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
  } catch (e) {
    document.getElementById('results').innerHTML =
      '<div class="panel"><div class="flag-note">Parsing error: ' +
      e.message +
      '. This format may differ slightly from what the parser expects — paste a small sample and we can adjust it.</div></div>';
  }
});
