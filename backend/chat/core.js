// ---------- AI chat backend: pure logic ----------
// Everything that decides who may chat, what it costs and what is sent to the model lives here,
// with no AWS or network code, so it can be tested with stand-ins. handler.js wires in the real
// services (DynamoDB, SSM Parameter Store, SNS, and the Claude API).
//
// Flow for one message:
//   1. API Gateway has already checked the login token's signature (JWT authorizer, using
//      Cognito's public keys). We only read its claims.
//   2. Validate the request body.
//   3. Refuse if this month's spend has reached the budget.
//   4. Count the message against the user's daily allowance (free or full tier).
//   5. Ask the model.
//   6. Add the cost to the month's spend; email the owner the first time 50%, 80% and 100% of
//      the budget are passed.

// Dollars per million tokens. Cache writes cost 1.25× input; cache reads are listed separately.
// Unknown models are priced as Opus, the most expensive here, so spend is never under-counted.
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const THRESHOLDS = [50, 80, 100];

export const SYSTEM_PROMPT = [
  'You are a poker coach helping a tournament player review their own hands after the session is over.',
  'The hand below comes from the player’s hand-history review app. Opponents are anonymised as Villain 1, 2 and so on.',
  'Amounts, pot odds, required equity and bet sizes in it were calculated by the app; rely on them rather than recalculating.',
  'Give direct judgements with your reasoning: what the opponent’s range likely was at each decision, whether the',
  'player’s action was good, and what to consider next time. Judge decisions, not results.',
  'Keep answers focused and readable on a phone: short paragraphs, no more than about 300 words unless asked for more.',
  'Only help with reviewing past hands. If asked for help with a hand that is still being played, decline.',
].join(' ');

// Estimated cost in millionths of a dollar ("micro-dollars", whole numbers so totals add exactly).
export function costMicros(model, usage) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = usage.input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const output = usage.output_tokens || 0;
  // tokens × $/million = micro-dollars
  return Math.ceil(input * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.cacheRead + output * p.output);
}

// Tier from the login token's groups claim: members of the "full" group get the higher limit.
export function tierFor(claims) {
  const raw = claims['cognito:groups'];
  const groups = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .replace(/^\[|\]$/g, '')
        .split(/[\s,]+/);
  return groups.includes('full') ? 'full' : 'free';
}

const MAX_CONTEXT = 20000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE = 4000;

// Returns an error message, or null when the body is fine.
export function validateBody(body) {
  if (!body || typeof body !== 'object') return 'Body must be JSON.';
  if (typeof body.context !== 'string' || !body.context.trim()) return 'Missing hand context.';
  if (body.context.length > MAX_CONTEXT) return `Hand context is too long (over ${MAX_CONTEXT} characters).`;
  const m = body.messages;
  if (!Array.isArray(m) || !m.length) return 'Missing messages.';
  if (m.length > MAX_MESSAGES) return `Conversation is too long (over ${MAX_MESSAGES} messages); start a new one.`;
  for (let i = 0; i < m.length; i++) {
    const msg = m[i];
    const want = i % 2 === 0 ? 'user' : 'assistant';
    if (!msg || msg.role !== want) return 'Messages must alternate, starting and ending with the user.';
    if (typeof msg.content !== 'string' || !msg.content.trim()) return 'Messages must have text.';
    if (msg.content.length > MAX_MESSAGE) return `A message is too long (over ${MAX_MESSAGE} characters).`;
  }
  if (m[m.length - 1].role !== 'user') return 'The last message must be from the user.';
  return null;
}

// The request sent to the model. The instructions and the hand go in the system prompt, marked
// for prompt caching: they stay identical for the whole conversation, so later messages read
// them from the cache at a fraction of the price.
export function buildModelRequest(model, body) {
  return {
    model,
    max_tokens: 2000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: 'The hand:\n\n' + body.context, cache_control: { type: 'ephemeral' } },
    ],
    messages: body.messages.map(m => ({ role: m.role, content: m.content })),
  };
}

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

// deps: { config, store, ask, notify, now }
//   config: { model, budgetMicros, limits: { free, full } }
//   store:  getSpend(month) -> { micros, notified[] }
//           takeDailySlot(userId, day, limit) -> { ok, count }
//           addSpend(month, micros) -> new total micros
//           markNotified(month, threshold) -> true the first time only
//   ask(request) -> { text, usage, model, refused }
//   notify(subject, message)
export async function handleChat(event, deps) {
  const { config, store, ask, notify, now } = deps;
  const claims =
    event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt
      ? event.requestContext.authorizer.jwt.claims
      : null;
  if (!claims || !claims.sub) return json(401, { error: 'Sign in to use the chat.' });

  let body;
  try {
    body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '');
  } catch {
    return json(400, { error: 'Body must be JSON.' });
  }
  const invalid = validateBody(body);
  if (invalid) return json(400, { error: invalid });

  const date = new Date(now());
  const month = date.toISOString().slice(0, 7);
  const day = date.toISOString().slice(0, 10);

  const spend = await store.getSpend(month);
  if (spend.micros >= config.budgetMicros) {
    return json(503, { error: 'The chat has reached this month’s spending limit. It resets next month.' });
  }

  const tier = tierFor(claims);
  const limit = config.limits[tier];
  const slot = await store.takeDailySlot(claims.sub, day, limit);
  if (!slot.ok) {
    return json(429, {
      error:
        `You’ve used today’s ${limit} message${limit === 1 ? '' : 's'}` +
        (tier === 'free' ? ' on a free account' : '') +
        '. It resets at midnight UTC.',
    });
  }

  let answer;
  try {
    answer = await ask(buildModelRequest(config.model, body));
  } catch (e) {
    return json(502, { error: 'The AI service didn’t answer. Try again in a moment.', detail: String(e.message || e) });
  }

  const cost = costMicros(answer.model || config.model, answer.usage || {});
  const total = await store.addSpend(month, cost);
  const pct = (100 * total) / config.budgetMicros;
  for (const t of THRESHOLDS) {
    if (pct >= t && (await store.markNotified(month, t))) {
      await notify(
        `Poker chat: ${t}% of the monthly budget used`,
        `The AI chat has used $${(total / 1e6).toFixed(2)} of its $${(config.budgetMicros / 1e6).toFixed(2)} budget ` +
          `for ${month} (${Math.round(pct)}%).` +
          (t >= 100 ? ' New messages are refused until next month.' : ''),
      );
    }
  }

  return json(200, {
    reply: answer.refused
      ? 'The model declined to answer this one. Try rephrasing, or ask about a specific decision in the hand.'
      : answer.text,
    model: answer.model || config.model,
    tier,
    remainingToday: Math.max(0, limit - slot.count),
  });
}
