import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIndex, validateMeta } from './schema.js';
import { logger } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../data/content');

// Process-wide singleton so commands/services share one validated, indexed copy.
let _cache = null;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/**
 * Load and validate the content store from disk, building in-memory indexes and
 * caching the result. `strict` fails loud (throws) on any invalid file — the dev
 * default — while `strict: false` skips the offending bracket and logs, so one
 * bad file can't take the bot down in prod (03-data-model.md §Loader & validation).
 *
 * The returned store shape:
 *   { schemaVersion, brackets: { <key>: { meta } }, bracketKeys: string[] }
 *
 * @param {{ dir?: string, strict?: boolean }} [opts]
 */
export async function loadContentStore({ dir = CONTENT_DIR, strict = true } = {}) {
  const index = await readJson(path.join(dir, 'index.json'));
  const indexResult = validateIndex(index);
  if (!indexResult.ok) {
    const msg = `content index.json invalid: ${indexResult.errors.join('; ')}`;
    if (strict) throw new Error(msg);
    logger.error(msg);
    _cache = { schemaVersion: null, brackets: {}, bracketKeys: [] };
    return _cache;
  }

  const brackets = {};
  for (const key of index.brackets) {
    let meta;
    try {
      meta = await readJson(path.join(dir, key, 'meta.json'));
    } catch (err) {
      if (strict) throw err;
      logger.error({ err, bracket: key }, 'content: failed to read bracket meta');
      continue;
    }

    const metaResult = validateMeta(meta, `${key}/meta.json`);
    if (!metaResult.ok) {
      const msg = `content ${key}/meta.json invalid: ${metaResult.errors.join('; ')}`;
      if (strict) throw new Error(msg);
      logger.error(msg);
      continue;
    }

    brackets[key] = { meta };
  }

  _cache = {
    schemaVersion: index.schemaVersion,
    brackets,
    bracketKeys: Object.keys(brackets)
  };
  return _cache;
}

/** Cached store, loading it (strict) on first access. */
export async function getContentStore() {
  if (!_cache) await loadContentStore();
  return _cache;
}

/** Drop the cached store so the next `getContentStore()` reloads from disk. */
export function resetContentStore() {
  _cache = null;
}

/** A guild's primary (default) bracket: first in activeBrackets, else "19". */
export function primaryBracket(config) {
  return config?.activeBrackets?.[0] ?? '19';
}
