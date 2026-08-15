import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * File-backed persistence primitive — the file *backend* behind the storage seam
 * (storage/kv.js). It is the single place the app touches the filesystem for
 * mutable state; `guildConfig` and `latchStore` reach it only via kv.js (which
 * resolves their logical keys to paths), so the backend can be swapped for a
 * Postgres/KV adapter without editing call sites (the prereq for a Heroku move off
 * the ephemeral FS).
 *
 * The seam is a small key/value contract:
 *   - `readText(key)`   → raw string, or `null` when absent
 *   - `writeJson(key, value)` → atomic persist of a JSON value
 *   - `withLock(key, fn)` → serialize a read-modify-write against a key
 *
 * A future Postgres/KV adapter implements the same three functions keyed by an
 * opaque string. For this file backend the `key` is an absolute file path, so the
 * two stores keep computing their own paths (and their own missing/corrupt-read
 * policies) exactly as before — this module owns only the shared mechanics.
 */

/**
 * Per-key async mutex (promise chain). Serializes read-modify-write for a given
 * key so concurrent writers — e.g. the per-tick board updater racing an admin
 * toggle — can't clobber each other's fields. In-process only, which is correct
 * for the single-fork pm2 model; a future Postgres backend replaces it with a row
 * transaction. Keyed by the opaque `key` so distinct keys never contend.
 */
const _locks = new Map();

/**
 * Read a key's raw contents. Missing key => `null`. Any other IO error (e.g.
 * EACCES) throws — callers decide their own missing/corrupt policy, and parsing
 * (JSON.parse) is deliberately left to the caller so each store can choose to
 * fail loud or self-heal on malformed content.
 */
export async function readText(key) {
  try {
    return await fs.readFile(key, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Persist a JSON value to a key, creating parent directories as needed. Writes to
 * a temp file then atomically renames it into place (uv rename uses
 * MOVEFILE_REPLACE_EXISTING on Windows), so a crash mid-write can never leave a
 * truncated/zero-filled file — on disk the key is always either the old or the new
 * complete value.
 */
export async function writeJson(key, value) {
  await fs.mkdir(path.dirname(key), { recursive: true });
  const tmp = `${key}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, key);
}

/** Serialize an async `fn` against `key` via a per-key promise-chain mutex. */
export function withLock(key, fn) {
  const next = (_locks.get(key) ?? Promise.resolve()).then(fn, fn);
  _locks.set(
    key,
    next.catch(() => {})
  );
  return next;
}
