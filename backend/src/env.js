import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Single source of truth: the repo-root .env (local dev runs; production
// injects the same values via the systemd unit environment, see docs/DEPLOY.md).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/** Read a required env var; throw a consistent error if it is missing. */
export function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
