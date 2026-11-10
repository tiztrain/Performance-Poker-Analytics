import { describe, it, expect } from 'vitest';
import { batches, mergeSnapshots, snapshot, SYNC_KEYS } from '../src/engine/sync.js';
import { handleSync, validRecords } from '../backend/sync/core.js';

describe('mergeSnapshots', () => {
  it('combines quiz answers from both devices without duplicates', () => {
    const a = JSON.stringify([
      { key: 'h1:flop', at: '2026-11-01' },
      { key: 'h2:river', at: '2026-11-03' },
    ]);
    const b = JSON.stringify([
      { key: 'h1:flop', at: '2026-11-01' },
      { key: 'h3:turn', at: '2026-11-02' },
    ]);
    const merged = JSON.parse(
      mergeSnapshots({ 'handReadingQuiz.v1': a }, { 'handReadingQuiz.v1': b })['handReadingQuiz.v1'],
    );
    expect(merged.map(r => r.key)).toEqual(['h1:flop', 'h3:turn', 'h2:river']); // by time
  });

  it('combines reviewed marks and keeps the further-along drill', () => {
    const a = JSON.stringify({ reviewed: { 1: true }, drills: { 9: { level: 1, due: 100 } } });
    const b = JSON.stringify({ reviewed: { 2: true }, drills: { 9: { level: 2, due: 50 }, 8: { level: 0, due: 10 } } });
    const merged = JSON.parse(mergeSnapshots({ 'reviewQueue.v1': a }, { 'reviewQueue.v1': b })['reviewQueue.v1']);
    expect(merged.reviewed).toEqual({ 1: true, 2: true });
    expect(merged.drills).toEqual({ 9: { level: 2, due: 50 }, 8: { level: 0, due: 10 } });
  });

  it('three-way merges other settings against the last synced snapshot', () => {
    const base = { 'statTargets.v1': 'A', 'rangeModel.v1': 'R1', 'handReadingQuiz.timing': 'every' };
    const local = { 'statTargets.v1': 'A', 'rangeModel.v1': 'R2', 'handReadingQuiz.timing': 'river' };
    const remote = { 'statTargets.v1': 'B', 'rangeModel.v1': 'R1', 'handReadingQuiz.timing': 'every' };
    expect(mergeSnapshots(local, remote, base)).toEqual({
      'statTargets.v1': 'B', // changed only on the other device: theirs
      'rangeModel.v1': 'R2', // changed only here: ours
      'handReadingQuiz.timing': 'river',
    });
    // Changed on both: this device's version wins.
    expect(mergeSnapshots({ 'statTargets.v1': 'C' }, { 'statTargets.v1': 'B' }, { 'statTargets.v1': 'A' })).toEqual({
      'statTargets.v1': 'C',
    });
    // A first sync on a new device takes everything from the account.
    expect(mergeSnapshots({}, { 'statTargets.v1': 'B' }, {})).toEqual({ 'statTargets.v1': 'B' });
  });

  it('reads only the synced keys from storage', () => {
    const data = { 'statTargets.v1': '{}', 'auth.tokens': 'secret', 'reviewQueue.v1': '{}' };
    const storage = { getItem: k => (k in data ? data[k] : null) };
    expect(snapshot(storage)).toEqual({ 'statTargets.v1': '{}', 'reviewQueue.v1': '{}' });
    expect(SYNC_KEYS).not.toContain('auth.tokens');
  });

  it('splits uploads into batches of 500', () => {
    const recs = Array.from({ length: 1201 }, (_, i) => i);
    expect(batches(recs).map(b => b.length)).toEqual([500, 500, 201]);
  });
});

function fakeS3() {
  const store = new Map();
  return {
    store,
    s3: {
      list: async prefix => [...store.keys()].filter(k => k.startsWith(prefix)),
      get: async key => (store.has(key) ? store.get(key) : null),
      put: async (key, body) => store.set(key, body),
    },
  };
}

const ev = (sub, routeKey, body, pathParameters) => ({
  routeKey,
  requestContext: sub ? { authorizer: { jwt: { claims: { sub } } } } : {},
  body: body === undefined ? undefined : JSON.stringify(body),
  pathParameters,
});

describe('handleSync (backend)', () => {
  const deps = s3 => ({ s3, now: () => 1700000000000, random: () => 'abcd1234' });

  it('needs a login', async () => {
    expect((await handleSync(ev(null, 'GET /sync'), deps(fakeS3().s3))).statusCode).toBe(401);
  });

  it('stores an upload batch in the user’s own folder and lists it back', async () => {
    const { s3, store } = fakeS3();
    const up = await handleSync(
      ev('user-a', 'POST /sync/chunk', { records: [{ id: '123', raw: 'CoinPoker Hand #123' }] }),
      deps(s3),
    );
    expect(JSON.parse(up.body)).toEqual({ name: '1700000000000-abcd1234.json' });
    expect([...store.keys()]).toEqual(['users/user-a/hands/1700000000000-abcd1234.json']);
    const list = JSON.parse((await handleSync(ev('user-a', 'GET /sync'), deps(s3))).body);
    expect(list).toEqual({ chunks: ['1700000000000-abcd1234.json'], settings: null });
    const chunk = await handleSync(
      ev('user-a', 'GET /sync/chunk/{name}', undefined, { name: list.chunks[0] }),
      deps(s3),
    );
    expect(JSON.parse(chunk.body).records).toEqual([{ id: '123', raw: 'CoinPoker Hand #123' }]);
  });

  it('never shows one user another user’s data', async () => {
    const { s3 } = fakeS3();
    await handleSync(ev('user-a', 'POST /sync/chunk', { records: [{ id: '1', raw: 'x' }] }), deps(s3));
    const b = JSON.parse((await handleSync(ev('user-b', 'GET /sync'), deps(s3))).body);
    expect(b.chunks).toEqual([]);
    const sneaky = await handleSync(
      ev('user-b', 'GET /sync/chunk/{name}', undefined, { name: '1700000000000-abcd1234.json' }),
      deps(s3),
    );
    expect(sneaky.statusCode).toBe(404); // looked in user-b's folder, not user-a's
  });

  it('rejects path tricks and bad records', async () => {
    const { s3 } = fakeS3();
    const tricky = await handleSync(
      ev('user-a', 'GET /sync/chunk/{name}', undefined, { name: '../user-b/settings.json' }),
      deps(s3),
    );
    expect(tricky.statusCode).toBe(400);
    expect(validRecords([{ id: '12', raw: 'ok' }])).toBe(true);
    expect(validRecords([{ id: '../x', raw: 'ok' }])).toBe(false);
    expect(validRecords([])).toBe(false);
    const bad = await handleSync(ev('user-a', 'POST /sync/chunk', { records: [{ id: 5 }] }), deps(s3));
    expect(bad.statusCode).toBe(400);
  });

  it('saves and returns settings as strings only', async () => {
    const { s3 } = fakeS3();
    expect((await handleSync(ev('u', 'PUT /sync/settings', { settings: { k: 1 } }), deps(s3))).statusCode).toBe(400);
    await handleSync(ev('u', 'PUT /sync/settings', { settings: { 'statTargets.v1': '{}' } }), deps(s3));
    expect(JSON.parse((await handleSync(ev('u', 'GET /sync'), deps(s3))).body).settings).toEqual({
      'statTargets.v1': '{}',
    });
  });
});
