// ---------- OAuth 2.0 + PKCE helpers (pure, no DOM or storage access) ----------
// Login uses the OAuth "authorization code" flow with PKCE against Cognito's hosted
// login pages:
//   1. the app makes a random secret (the "code verifier") and sends only its
//      SHA-256 hash (the "code challenge") when redirecting to the login page;
//   2. after login, Cognito redirects back with a one-time `code`;
//   3. the app trades that code, plus the original verifier, for tokens.
// Anyone who intercepts the code can't use it without the verifier, which never left
// the browser. That is what lets a static site with no backend log users in safely,
// since it has nowhere to keep a client secret.
//
// Everything here is a pure function so it can be unit-tested in Node; session.js
// does the redirects, storage and network calls.

export function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecodeToString(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// 32 random bytes -> 43 base64url characters, inside PKCE's 43-128 character range.
export function randomString(byteLength = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// `page` is 'login' or 'signup'; Cognito serves both from the same parameters.
export function buildAuthorizeUrl({ domain, clientId, redirectUri, state, challenge, page = 'login' }) {
  const path = page === 'signup' ? '/signup' : '/oauth2/authorize';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://${domain}${path}?${params}`;
}

export function buildTokenRequestBody({ clientId, code, redirectUri, verifier }) {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }).toString();
}

export function buildLogoutUrl({ domain, clientId, logoutUri }) {
  const params = new URLSearchParams({ client_id: clientId, logout_uri: logoutUri });
  return `https://${domain}/logout?${params}`;
}

// Reads the query string Cognito redirects back with. Returns null when the URL
// isn't a login callback at all.
export function parseCallback(search) {
  const params = new URLSearchParams(search);
  if (params.has('error')) {
    return { error: params.get('error_description') || params.get('error'), state: params.get('state') };
  }
  if (params.has('code')) return { code: params.get('code'), state: params.get('state') };
  return null;
}

// A JWT is three base64url parts: header.payload.signature. This only *reads* the
// payload, it does not check the signature. That's fine for showing the user's email
// in the page, because the token came straight from Cognito over HTTPS. Anything
// that trusts the token to grant access (the storage API in the next phase) must
// verify the signature server-side.
export function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch {
    return null;
  }
}

// `exp` is in seconds since 1970. The skew margin treats a token as expired slightly
// early, so it isn't used in the last moments of its life.
export function isExpired(claims, nowMs = Date.now(), skewSeconds = 30) {
  if (!claims || typeof claims.exp !== 'number') return true;
  return claims.exp - skewSeconds <= nowMs / 1000;
}
