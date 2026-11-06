import { describe, it, expect } from 'vitest';
import {
  base64UrlEncode,
  buildAuthorizeUrl,
  buildLogoutUrl,
  buildTokenRequestBody,
  codeChallenge,
  decodeJwtPayload,
  isExpired,
  parseCallback,
  randomString,
} from '../src/auth/oauth.js';

function fakeJwt(payload) {
  const enc = obj => base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  return `${enc({ alg: 'RS256' })}.${enc(payload)}.signature`;
}

describe('PKCE', () => {
  it('matches the code challenge from the PKCE spec (RFC 7636, appendix B)', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('makes random verifiers of valid length and alphabet', () => {
    const a = randomString();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString()).not.toBe(a);
  });
});

describe('Cognito URLs', () => {
  const base = { domain: 'x.auth.ap-southeast-2.amazoncognito.com', clientId: 'abc', redirectUri: 'https://site/' };

  it('builds a login URL with the PKCE challenge and state', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, state: 's1', challenge: 'c1' }));
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'abc',
      redirect_uri: 'https://site/',
      scope: 'openid email',
      state: 's1',
      code_challenge: 'c1',
      code_challenge_method: 'S256',
    });
  });

  it('sends "Create account" to the sign-up page', () => {
    expect(new URL(buildAuthorizeUrl({ ...base, state: 's', challenge: 'c', page: 'signup' })).pathname).toBe(
      '/signup',
    );
  });

  it('includes the verifier in the token request', () => {
    const body = new URLSearchParams(buildTokenRequestBody({ ...base, code: 'k', verifier: 'v' }));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v');
    expect(body.get('redirect_uri')).toBe('https://site/');
  });

  it('builds a logout URL', () => {
    const url = new URL(buildLogoutUrl({ domain: base.domain, clientId: 'abc', logoutUri: 'https://site/' }));
    expect(url.pathname).toBe('/logout');
    expect(url.searchParams.get('logout_uri')).toBe('https://site/');
  });
});

describe('parseCallback', () => {
  it('ignores ordinary page loads', () => {
    expect(parseCallback('')).toBeNull();
  });

  it('reads the code and state', () => {
    expect(parseCallback('?code=k&state=s')).toEqual({ code: 'k', state: 's' });
  });

  it('reports an error from Cognito', () => {
    expect(parseCallback('?error=access_denied&error_description=nope&state=s')).toEqual({
      error: 'nope',
      state: 's',
    });
  });
});

describe('ID token', () => {
  it('decodes the payload, including non-ASCII text', () => {
    expect(decodeJwtPayload(fakeJwt({ email: 'zoë@example.com', exp: 1 }))).toEqual({
      email: 'zoë@example.com',
      exp: 1,
    });
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwtPayload(undefined)).toBeNull();
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.###.c')).toBeNull();
  });

  it('treats tokens as expired shortly before exp, and missing claims as expired', () => {
    const now = 1_000_000_000_000; // ms
    expect(isExpired({ exp: now / 1000 + 3600 }, now)).toBe(false);
    expect(isExpired({ exp: now / 1000 + 10 }, now)).toBe(true);
    expect(isExpired(null, now)).toBe(true);
  });
});
