// Move all OSS objects from the bucket root into the `zyxf/` prefix.
//
// The website's sync (routes/sync.js) only lists objects under
// OSS_KEY_PREFIX ("zyxf"), so files uploaded directly to the bucket root are
// invisible to it. OSS has no rename — this copies each object to
// `zyxf/<key>` and deletes the original only after the copy succeeds.
//
// Usage:
//   node scripts/move-oss-to-prefix.mjs --dry   # only report what would move
//   node scripts/move-oss-to-prefix.mjs         # actually move
import '../src/env.js';
import { ossClient } from '../src/oss.js';
import { ossPrefix } from '../src/storagePath.js';

const DRY = process.argv.includes('--dry');
const client = ossClient();
const prefix = ossPrefix() ? `${ossPrefix()}/` : '';

async function exists(key) {
  try {
    await client.head(key);
    return true;
  } catch {
    return false;
  }
}

let moved = 0;
let skipped = 0;
let conflicts = 0;
const failed = [];
let marker;
let res;

do {
  res = await client.list({ marker, 'max-keys': 1000 });
  for (const o of res.objects || []) {
    const key = o.name;
    if (key.startsWith(prefix)) {
      skipped++; // already under the prefix
      continue;
    }
    if (key.startsWith('.preview/') || key.startsWith(`${prefix}.preview/`)) {
      skipped++; // internal IMM shadow copies
      continue;
    }
    const dest = `${prefix}${key}`;
    if (await exists(dest)) {
      conflicts++;
      console.log(`CONFLICT (skip): ${key} -> ${dest} already exists`);
      continue;
    }
    if (DRY) {
      moved++;
      continue;
    }
    try {
      await client.copy(dest, key);
      await client.delete(key);
      moved++;
    } catch (e) {
      failed.push({ key, err: e.message || String(e) });
    }
  }
  marker = res.nextMarker;
} while (res.isTruncated && marker);

console.log(
  JSON.stringify(
    { mode: DRY ? 'dry-run' : 'move', moved, skipped, conflicts, failedCount: failed.length, failed: failed.slice(0, 20) },
    null,
    2
  )
);
