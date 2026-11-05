// ---------- Small shared UI state ----------
// Global display unit for every money figure on the page. `currentRerender` is
// re-pointed at whatever view is currently on screen each time renderResults
// runs, so toggling the unit just re-draws the current view in the new unit
// without losing the active date/tournament selection.
export let displayMode = 'bb'; // 'bb' | 'chips'
export let currentRerender = null;

export function setDisplayMode(mode) {
  displayMode = mode;
}

export function setCurrentRerender(fn) {
  currentRerender = fn;
}
