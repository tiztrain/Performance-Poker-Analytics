// ---------- Cloud history sync (browser side) ----------
// When the site is built with VITE_SYNC_API_URL and you're signed in, your saved hands and
// settings follow you to every device:
// - On opening: download any upload batches this device hasn't seen, merge settings
//   (engine/sync.js), and the first time on a device, upload the history it already has.
// - After each analysis: upload the new hands as one batch.
// - When you leave the page: save the settings snapshot.
// The server (backend/sync) only ever reads or writes the signed-in user's own folder.

import { accessToken, authEnabled, currentUser } from '../auth/session.js';
import { batches, mergeSnapshots, snapshot } from '../engine/sync.js';

const API = (import.meta.env.VITE_SYNC_API_URL || '').replace(/\/$/, '');

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function createCloudSync(history) {
  if (!API || !authEnabled) return null;

  async function call(method, path, body, keepalive = false) {
    const token = accessToken();
    if (!token) throw new Error('signed out');
    const res = await fetch(API + path, {
      method,
      keepalive,
      headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
  }

  const keys = sub => ({ seen: 'sync.seen.' + sub, initial: 'sync.initial.' + sub, base: 'sync.base.' + sub });

  async function upload(records, sub) {
    const seen = new Set(readJson(keys(sub).seen, []));
    for (const batch of batches(records)) {
      const { name } = await call('POST', '/sync/chunk', { records: batch });
      seen.add(name); // our own upload: no need to download it again
    }
    localStorage.setItem(keys(sub).seen, JSON.stringify([...seen]));
  }

  async function pushSettings(keepalive = false) {
    const user = currentUser();
    if (!user) return;
    const local = snapshot(localStorage);
    await call('PUT', '/sync/settings', { settings: local }, keepalive);
    localStorage.setItem(keys(user.sub).base, JSON.stringify(local));
  }

  return {
    // Returns 'synced', 'signed-out' or throws.
    async pull() {
      const user = currentUser();
      if (!user || !accessToken()) return 'signed-out';
      const k = keys(user.sub);
      const { chunks, settings } = await call('GET', '/sync');
      const seen = new Set(readJson(k.seen, []));
      const downloaded = new Set();
      for (const name of chunks.filter(n => !seen.has(n))) {
        const { records } = await call('GET', '/sync/chunk/' + name);
        await history.putMany(records);
        records.forEach(r => downloaded.add(r.id));
        seen.add(name);
      }
      localStorage.setItem(k.seen, JSON.stringify([...seen]));

      const merged = mergeSnapshots(snapshot(localStorage), settings || {}, readJson(k.base, {}));
      Object.entries(merged).forEach(([key, value]) => localStorage.setItem(key, value));
      localStorage.setItem(k.base, JSON.stringify(merged));
      // Compare with keys in a fixed order, so the same settings listed differently don't count as a change.
      const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
      if (!same(merged, settings || {})) await pushSettings();

      if (!localStorage.getItem(k.initial)) {
        // Hands that just came from the account are already there.
        await upload(
          (await history.all()).filter(r => !downloaded.has(r.id)),
          user.sub,
        );
        localStorage.setItem(k.initial, '1');
      }
      return 'synced';
    },
    async pushRecords(records) {
      const user = currentUser();
      if (!user || !records.length || !localStorage.getItem(keys(user.sub).initial)) return;
      await upload(records, user.sub);
    },
    pushSettings,
  };
}
