// ---------- Copy for Claude button ----------
// Shared by the hand table and the hand-reading quiz.

// "Copy for Claude": puts the hand summary on the clipboard. Browsers only allow clipboard
// writes on secure pages (https or localhost) and can refuse them, so on failure the text is
// shown in a box to copy by hand instead.
export function bindCopyButton(detailEl, getText) {
  const btn = detailEl.querySelector('.copy-claude-btn');
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied ✓';
      setTimeout(() => {
        btn.textContent = 'Copy for Claude';
      }, 1800);
    } catch {
      let box = detailEl.querySelector('.copy-fallback');
      if (!box) {
        box = document.createElement('textarea');
        box.className = 'copy-fallback';
        box.readOnly = true;
        btn.parentElement.after(box);
      }
      box.value = text;
      box.select();
      btn.textContent = 'Copy the text below';
    }
  });
}
