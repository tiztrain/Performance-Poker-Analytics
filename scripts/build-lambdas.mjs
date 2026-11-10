// Builds the AWS Lambda code for `terraform apply`: infra/build/chat-lambda.zip (AI chat) and
// infra/build/sync-lambda.zip (cloud history). Run with `npm run build:lambdas`.
// 1. esbuild bundles each backend/*/handler.js (with the Anthropic SDK, for the chat) into one
//    file. The AWS SDK is left out because the Lambda Node.js runtime already includes it.
// 2. The bundle is zipped with Node's built-in compression, so this works the same on Windows,
//    macOS and Linux without a separate zip tool.

import { build } from 'esbuild';
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outDir = new URL('../infra/build/', import.meta.url);
mkdirSync(outDir, { recursive: true });

async function bundle(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['@aws-sdk/*'],
    write: false,
    minify: true,
    // Some bundled CommonJS code calls require(); give the ES module a working one.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  return Buffer.from(result.outputFiles[0].contents);
}

// ---- Minimal zip writer: one file, deflate-compressed ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipOne(name, data) {
  const nameBuf = Buffer.from(name);
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  // Fixed timestamp (1 Jan 2020) so the same code always gives the same zip, and Terraform only
  // redeploys when the code really changed.
  const time = 0;
  const date = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, readable
  central.writeUInt32LE(0, 42);
  const localSize = local.length + nameBuf.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(localSize, 16);
  return Buffer.concat([local, nameBuf, compressed, central, nameBuf, end]);
}

for (const [name, entry] of [
  ['chat-lambda.zip', '../backend/chat/handler.js'],
  ['sync-lambda.zip', '../backend/sync/handler.js'],
]) {
  const code = await bundle(entry);
  const zip = zipOne('index.mjs', code);
  writeFileSync(new URL(name, outDir), zip);
  readFileSync(new URL(name, outDir)); // sanity check that the file round-trips
  console.log(
    `infra/build/${name}: ${(code.length / 1024).toFixed(0)} KB bundle, ${(zip.length / 1024).toFixed(0)} KB zipped`,
  );
}
