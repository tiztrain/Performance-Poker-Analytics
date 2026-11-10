// ---------- AI chat backend: AWS Lambda entry point ----------
// Wires the pure logic in core.js to the real services. Bundled into one file by
// scripts/build-chat-lambda.mjs (the AWS SDK is already in the Lambda runtime, so it isn't
// bundled). Configuration comes from environment variables set by infra/chat.tf.
//
// The model provider is swappable: CHAT_PROVIDER=anthropic is the only one today. A self-hosted
// model (for example Ollama on a home-lab machine) would be a second `ask` function here,
// selected by the same variable; core.js wouldn't change.

import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import Anthropic from '@anthropic-ai/sdk';
import { handleChat } from './core.js';

const env = process.env;
const TABLE = env.CHAT_TABLE;
const dynamo = new DynamoDBClient({});
const ssm = new SSMClient({});
const sns = new SNSClient({});

const config = {
  model: env.CHAT_MODEL || 'claude-opus-5-5',
  budgetMicros: Math.round(Number(env.MONTHLY_BUDGET_USD || 10) * 1e6),
  limits: { free: Number(env.FREE_DAILY_LIMIT || 3), full: Number(env.FULL_DAILY_LIMIT || 30) },
};

// The API key is read once per Lambda instance from SSM Parameter Store (encrypted at rest),
// never from the website or the code.
let client = null;
async function anthropic() {
  if (!client) {
    const p = await ssm.send(new GetParameterCommand({ Name: env.ANTHROPIC_KEY_PARAM, WithDecryption: true }));
    client = new Anthropic({ apiKey: p.Parameter.Value, timeout: 25_000, maxRetries: 1 });
  }
  return client;
}

// Claude via the official SDK. Server-side fallbacks are on: if the model declines a request
// for safety reasons, the API re-runs it on a fallback model it chooses ("default").
async function askAnthropic(request) {
  const c = await anthropic();
  const response = await c.beta.messages.create({
    ...request,
    // Low effort keeps replies inside API Gateway's 30-second limit; chat-style review does
    // well at low effort.
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  return { text, usage: response.usage, model: response.model, refused: response.stop_reason === 'refusal' };
}

const store = {
  async getSpend(month) {
    const r = await dynamo.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: 'spend#' + month } } }));
    return {
      micros: r.Item && r.Item.micros ? Number(r.Item.micros.N) : 0,
      notified: r.Item && r.Item.notified ? r.Item.notified.NS.map(Number) : [],
    };
  },
  async takeDailySlot(userId, day, limit) {
    try {
      const r = await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { pk: { S: `user#${userId}#${day}` } },
          UpdateExpression: 'ADD #c :one SET #t = :ttl',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':limit': { N: String(limit) },
            ':ttl': { N: String(Math.floor(Date.now() / 1000) + 3 * 86400) }, // DynamoDB deletes it after 3 days
          },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return { ok: true, count: Number(r.Attributes.count.N) };
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') return { ok: false, count: limit };
      throw e;
    }
  },
  async addSpend(month, micros) {
    const r = await dynamo.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { pk: { S: 'spend#' + month } },
        UpdateExpression: 'ADD micros :m',
        ExpressionAttributeValues: { ':m': { N: String(micros) } },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(r.Attributes.micros.N);
  },
  async markNotified(month, threshold) {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { pk: { S: 'spend#' + month } },
          UpdateExpression: 'ADD notified :t',
          ConditionExpression: 'attribute_not_exists(notified) OR NOT contains(notified, :n)',
          ExpressionAttributeValues: { ':t': { NS: [String(threshold)] }, ':n': { N: String(threshold) } },
        }),
      );
      return true;
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') return false;
      throw e;
    }
  },
};

async function notify(subject, message) {
  if (!env.ALERT_TOPIC_ARN) return;
  await sns.send(new PublishCommand({ TopicArn: env.ALERT_TOPIC_ARN, Subject: subject, Message: message }));
}

const ask = (env.CHAT_PROVIDER || 'anthropic') === 'anthropic' ? askAnthropic : null;

export async function handler(event) {
  if (!ask) return { statusCode: 500, body: JSON.stringify({ error: 'Unknown CHAT_PROVIDER' }) };
  return handleChat(event, { config, store, ask, notify, now: () => Date.now() });
}
