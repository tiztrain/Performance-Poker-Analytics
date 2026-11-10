// ---------- Cloud history backend: AWS Lambda entry point ----------
// Wires core.js to S3. The bucket name comes from infra/history.tf. The AWS SDK is part of the
// Lambda runtime, so the bundle leaves it out (scripts/build-lambdas.mjs).

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { handleSync } from './core.js';

const s3client = new S3Client({});
const Bucket = process.env.HISTORY_BUCKET;

const s3 = {
  async list(prefix) {
    const keys = [];
    let token;
    do {
      const r = await s3client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
      (r.Contents || []).forEach(o => keys.push(o.Key));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  },
  async get(key) {
    try {
      const r = await s3client.send(new GetObjectCommand({ Bucket, Key: key }));
      return await r.Body.transformToString();
    } catch (e) {
      if (e.name === 'NoSuchKey') return null;
      throw e;
    }
  },
  async put(key, body) {
    await s3client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: 'application/json' }));
  },
};

export async function handler(event) {
  return handleSync(event, {
    s3,
    now: () => Date.now(),
    random: () => randomBytes(6).toString('hex').slice(0, 8),
  });
}
