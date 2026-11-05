// ---------- Login session (browser side effects) ----------
// Wraps oauth.js with the parts that touch the browser: redirects, sessionStorage
// and the token request. Login is optional: when the Cognito settings aren't
// provided at build time, `authEnabled` is false and the app behaves exactly as it
// did before accounts existed.
//
// Tokens live in sessionStorage, which is scoped to this tab and cleared when it
// closes. There is no refresh token handling yet, so a login lasts as long as the ID
// token (1 hour, set in infra/auth.tf).

import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  buildTokenRequestBody,
  codeChallenge,
  decodeJwtPayload,
  isExpired,
  parseCallback,
  randomString,
} from './oauth.js';

const domain = import.meta.env.VITE_COGNITO_DOMAIN || '';
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID || '';

export const authEnabled = Boolean(domain && clientId);

const KEY_PENDING = 'auth.pending'; // { state, verifier } while away at the login page
const KEY_TOKENS = 'auth.tokens'; // { idToken, accessToken }

// Must match one of the callback/logout URLs registered in infra/auth.tf exactly.
function redirectUri() {
  return window.location.origin + '/';
}

function readJson(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

async function redirectToHostedPage(page) {
  // `state` ties the callback to this tab's request, so a callback URL crafted by
  // someone else (CSRF) is rejected instead of logging you into their account.
  const state = randomString();
  const verifier = randomString();
  sessionStorage.setItem(KEY_PENDING, JSON.stringify({ state, verifier }));
  const challenge = await codeChallenge(verifier);
  window.location.assign(buildAuthorizeUrl({ domain, clientId, redirectUri: redirectUri(), state, challenge, page }));
}

export function login() {
  return redirectToHostedPage('login');
}

export function signup() {
  return redirectToHostedPage('signup');
}

export function logout() {
  sessionStorage.removeItem(KEY_TOKENS);
  window.location.assign(buildLogoutUrl({ domain, clientId, logoutUri: redirectUri() }));
}

// The signed-in user, or null. Expired tokens are discarded here.
export function currentUser() {
  if (!authEnabled) return null;
  const tokens = readJson(KEY_TOKENS);
  const claims = decodeJwtPayload(tokens?.idToken);
  if (isExpired(claims)) {
    sessionStorage.removeItem(KEY_TOKENS);
    return null;
  }
  return { email: claims.email || '', sub: claims.sub };
}

// Call once on page load. If the URL is Cognito's redirect back to us, finish the
// login and clean the code out of the address bar. Returns an error message to show,
// or null.
export async function completeLoginIfRedirected() {
  if (!authEnabled) return null;
  const callback = parseCallback(window.location.search);
  if (!callback) return null;

  const pending = readJson(KEY_PENDING);
  sessionStorage.removeItem(KEY_PENDING);
  window.history.replaceState(null, '', window.location.pathname);

  if (!pending || callback.state !== pending.state) return 'Sign-in failed: the login response did not match.';
  if (callback.error) return 'Sign-in failed: ' + callback.error;

  try {
    const res = await fetch(`https://${domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildTokenRequestBody({
        clientId,
        code: callback.code,
        redirectUri: redirectUri(),
        verifier: pending.verifier,
      }),
    });
    if (!res.ok) return 'Sign-in failed: the login server rejected the request.';
    const body = await res.json();
    sessionStorage.setItem(KEY_TOKENS, JSON.stringify({ idToken: body.id_token, accessToken: body.access_token }));
    return null;
  } catch {
    return 'Sign-in failed: could not reach the login server.';
  }
}
