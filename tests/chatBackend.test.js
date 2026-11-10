import { describe, it, expect } from 'vitest';
import { buildModelRequest, costMicros, handleChat, tierFor, validateBody } from '../backend/chat/core.js';

describe('costMicros', () => {
  it('prices Opus 5.5 at $4 in, $20 out, $0.20 cache read, 1.25× input for cache writes', () => {
    expect(costMicros('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 })).toBe(14000); // $0.014
    expect(costMicros('claude-opus-5-5', { cache_read_input_tokens: 3000 })).toBe(600); // $0.0006
    expect(costMicros('claude-opus-5-5', { cache_creation_input_tokens: 1000 })).toBe(5000); // $0.005
  });

  it('prices unknown models as Opus so spend is never under-counted', () => {
    expect(costMicros('some-other-model', { output_tokens: 100 })).toBe(2000);
  });
});

describe('tierFor', () => {
  it('reads the Cognito groups claim in its different encodings', () => {
    expect(tierFor({})).toBe('free');
    expect(tierFor({ 'cognito:groups': ['full'] })).toBe('full');
    expect(tierFor({ 'cognito:groups': '[full other]' })).toBe('full');
    expect(tierFor({ 'cognito:groups': 'other' })).toBe('free');
  });
});

describe('validateBody', () => {
  const ok = { context: 'hand', messages: [{ role: 'user', content: 'hi' }] };
  it('accepts a normal body', () => expect(validateBody(ok)).toBeNull());
  it.each([
    [null, 'Body must be JSON.'],
    [{ ...ok, context: '' }, 'Missing hand context.'],
    [{ ...ok, context: 'x'.repeat(20001) }, 'Hand context is too long (over 20000 characters).'],
    [{ ...ok, messages: [] }, 'Missing messages.'],
    [
      { ...ok, messages: [{ role: 'assistant', content: 'hi' }] },
      'Messages must alternate, starting and ending with the user.',
    ],
    [
      {
        ...ok,
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      },
      'The last message must be from the user.',
    ],
    [
      { ...ok, messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
      'A message is too long (over 4000 characters).',
    ],
  ])('rejects %#', (body, error) => expect(validateBody(body)).toBe(error));
});

describe('buildModelRequest', () => {
  it('puts the hand in the system prompt, marked for caching', () => {
    const r = buildModelRequest('claude-opus-5-5', { context: 'HAND', messages: [{ role: 'user', content: 'Q' }] });
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.system[1]).toEqual({ type: 'text', text: 'The hand:\n\nHAND', cache_control: { type: 'ephemeral' } });
    expect(r.messages).toEqual([{ role: 'user', content: 'Q' }]);
  });
});

// In-memory stand-ins for DynamoDB, the model and SNS.
function fakes({ budgetUsd = 10, free = 2, full = 5, usage = { input_tokens: 1000, output_tokens: 500 } } = {}) {
  const spend = { micros: 0, notified: [] };
  const counts = {};
  const sent = [];
  const asked = [];
  return {
    sent,
    asked,
    spend,
    deps: {
      config: { model: 'claude-opus-5-5', budgetMicros: budgetUsd * 1e6, limits: { free, full } },
      now: () => Date.UTC(2026, 10, 10, 12),
      store: {
        getSpend: async () => ({ ...spend }),
        takeDailySlot: async (user, day, limit) => {
          const k = user + day;
          if ((counts[k] || 0) >= limit) return { ok: false, count: limit };
          counts[k] = (counts[k] || 0) + 1;
          return { ok: true, count: counts[k] };
        },
        addSpend: async (month, m) => (spend.micros += m),
        markNotified: async (month, t) => (spend.notified.includes(t) ? false : (spend.notified.push(t), true)),
      },
      ask: async req => {
        asked.push(req);
        return { text: 'Reply', usage, model: 'claude-opus-5-5' };
      },
      notify: async (subject, message) => sent.push({ subject, message }),
    },
  };
}

const event = (groups, body = { context: 'hand', messages: [{ role: 'user', content: 'Review' }] }) => ({
  requestContext: { authorizer: { jwt: { claims: { sub: 'u1', ...(groups ? { 'cognito:groups': groups } : {}) } } } },
  body: JSON.stringify(body),
});

describe('handleChat', () => {
  it('needs a login', async () => {
    const f = fakes();
    expect((await handleChat({ requestContext: {}, body: '{}' }, f.deps)).statusCode).toBe(401);
  });

  it('answers and records the spend', async () => {
    const f = fakes();
    const r = await handleChat(event(), f.deps);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ reply: 'Reply', model: 'claude-opus-5-5', tier: 'free', remainingToday: 1 });
    expect(f.spend.micros).toBe(14000);
    expect(f.asked[0].system[1].text).toBe('The hand:\n\nhand');
  });

  it('limits free accounts per day, and gives the full group more', async () => {
    const f = fakes({ free: 1, full: 2 });
    expect((await handleChat(event(), f.deps)).statusCode).toBe(200);
    const blocked = await handleChat(event(), f.deps);
    expect(blocked.statusCode).toBe(429);
    expect(JSON.parse(blocked.body).error).toMatch(/1 message on a free account/);
    const g = fakes({ free: 1, full: 2 });
    expect((await handleChat(event(['full']), g.deps)).statusCode).toBe(200);
    expect((await handleChat(event(['full']), g.deps)).statusCode).toBe(200);
    expect((await handleChat(event(['full']), g.deps)).statusCode).toBe(429);
  });

  it('emails once at 50%, 80% and 100%, then refuses at the budget', async () => {
    // Each answer costs $0.30 (15,000 output tokens at $20 per million); the budget is $1.
    const f = fakes({ budgetUsd: 1, full: 10, usage: { output_tokens: 15000 } });
    for (let i = 0; i < 4; i++) await handleChat(event(['full']), f.deps); // $1.20 spent
    expect(f.sent.map(s => s.subject)).toEqual([
      'Poker chat: 50% of the monthly budget used',
      'Poker chat: 80% of the monthly budget used',
      'Poker chat: 100% of the monthly budget used',
    ]);
    expect(f.sent[2].message).toMatch(/\$1\.20 of its \$1\.00 budget/);
    const refused = await handleChat(event(['full']), f.deps);
    expect(refused.statusCode).toBe(503);
    expect(f.asked).toHaveLength(4); // the model wasn't asked again
  });

  it('rejects bad bodies before spending anything', async () => {
    const f = fakes();
    const r = await handleChat(event(undefined, { context: 'hand', messages: [] }), f.deps);
    expect(r.statusCode).toBe(400);
    expect(f.asked).toHaveLength(0);
  });

  it('reports a failed model call without charging', async () => {
    const f = fakes();
    f.deps.ask = async () => {
      throw new Error('timeout');
    };
    const r = await handleChat(event(), f.deps);
    expect(r.statusCode).toBe(502);
    expect(f.spend.micros).toBe(0);
  });

  it('says so when the model declines', async () => {
    const f = fakes();
    f.deps.ask = async () => ({ text: '', usage: {}, model: 'claude-opus-5-5', refused: true });
    expect(JSON.parse((await handleChat(event(), f.deps)).body).reply).toMatch(/declined/);
  });
});
