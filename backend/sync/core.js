// ---------- Cloud history backend: pure logic ----------
// Stores each signed-in user's hands and settings in their own folder in a private S3 bucket.
// API Gateway has already verified the Cognito login token; the user's folder is chosen from the
// token's `sub` (their permanent user ID), never from anything the browser sends, so one user can
// never read or write another's data. handler.js supplies the real S3 calls.
//
// Routes:
//   GET  /sync                -> { chunks: [names], settings: {...} | null }
//   GET  /sync/chunk/{name}   -> { records: [{ id, raw }] }
//   POST /sync/chunk          <- { records } -> { name }   (one upload batch)
//   PUT  /sync/settings       <- { settings: { key: string } }

export const MAX_RECORDS = 1000;
export const MAX_BODY = 3 * 1024 * 1024; // 3 MB per request
export const MAX_CHUNKS = 5000;
const NAME = /^[0-9]{13}-[a-z0-9]{8}\.json$/;

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

function userPrefix(event) {
  const c = event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt;
  const sub = c && c.claims && c.claims.sub;
  return sub && /^[A-Za-z0-9-]+$/.test(sub) ? `users/${sub}/` : null;
}

function readBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
  if (raw.length > MAX_BODY) return { error: 'Too large: send at most 3 MB at a time.' };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: 'Body must be JSON.' };
  }
}

export function validRecords(records) {
  return (
    Array.isArray(records) &&
    records.length > 0 &&
    records.length <= MAX_RECORDS &&
    records.every(
      r =>
        r && typeof r.id === 'string' && /^\d{1,20}$/.test(r.id) && typeof r.raw === 'string' && r.raw.length < 20000,
    )
  );
}

// deps: { s3: { list(prefix) -> [keys], get(key) -> string | null, put(key, string) }, now, random }
export async function handleSync(event, deps) {
  const prefix = userPrefix(event);
  if (!prefix) return json(401, { error: 'Sign in to sync.' });
  const route = event.routeKey;

  if (route === 'GET /sync') {
    const keys = await deps.s3.list(prefix + 'hands/');
    const settings = await deps.s3.get(prefix + 'settings.json');
    return json(200, {
      chunks: keys.map(k => k.slice((prefix + 'hands/').length)).filter(n => NAME.test(n)),
      settings: settings ? JSON.parse(settings) : null,
    });
  }

  if (route === 'GET /sync/chunk/{name}') {
    const name = event.pathParameters && event.pathParameters.name;
    if (!NAME.test(name || '')) return json(400, { error: 'Bad batch name.' });
    const data = await deps.s3.get(prefix + 'hands/' + name);
    if (!data) return json(404, { error: 'Not found.' });
    return json(200, { records: JSON.parse(data) });
  }

  if (route === 'POST /sync/chunk') {
    const { body, error } = readBody(event);
    if (error) return json(400, { error });
    if (!validRecords(body.records)) return json(400, { error: `Send 1 to ${MAX_RECORDS} hand records.` });
    const existing = await deps.s3.list(prefix + 'hands/');
    if (existing.length >= MAX_CHUNKS) return json(507, { error: 'Your cloud history is full.' });
    const name = `${deps.now()}-${deps.random()}.json`;
    await deps.s3.put(prefix + 'hands/' + name, JSON.stringify(body.records.map(r => ({ id: r.id, raw: r.raw }))));
    return json(200, { name });
  }

  if (route === 'PUT /sync/settings') {
    const { body, error } = readBody(event);
    if (error) return json(400, { error });
    const s = body.settings;
    if (!s || typeof s !== 'object' || Object.values(s).some(v => typeof v !== 'string')) {
      return json(400, { error: 'Settings must be an object of strings.' });
    }
    await deps.s3.put(prefix + 'settings.json', JSON.stringify(s));
    return json(200, { ok: true });
  }

  return json(404, { error: 'Unknown route.' });
}
