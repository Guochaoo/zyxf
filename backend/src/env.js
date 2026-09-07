import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth: the repo-root .env, read unconditionally in both
// local dev and production (deployed at /opt/zyxf/.env, see docs/DEPLOY.md §2).
// The systemd unit only injects NODE_ENV.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/** Read a required env var; throw a consistent error if it is missing. */
export function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Read an optional env var as a trimmed string ('' when unset). */
export function envStr(name) {
  return (process.env[name] || '').trim();
}
