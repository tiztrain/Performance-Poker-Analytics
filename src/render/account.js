// ---------- Header account area ----------
// Shows "Sign in / Create account", or the signed-in email with "Sign out". Takes the
// user and the actions as arguments so it stays free of auth logic.

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function renderAccount(el, { user, error, onLogin, onSignup, onLogout }) {
  const errorHtml = error ? `<div class="account-error">${escapeHtml(error)}</div>` : '';
  if (user) {
    el.innerHTML = `
      <span class="account-email" title="Signed in">${escapeHtml(user.email)}</span>
      <button class="account-btn" data-action="logout">Sign out</button>${errorHtml}`;
  } else {
    el.innerHTML = `
      <button class="account-btn" data-action="login">Sign in</button>
      <button class="account-btn primary-outline" data-action="signup">Create account</button>${errorHtml}`;
  }
  const actions = { login: onLogin, signup: onSignup, logout: onLogout };
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => actions[btn.dataset.action]());
  });
}
