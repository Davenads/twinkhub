import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateIndex,
  validateMeta,
  validateClassIndex,
  validateClass,
  validateEnchants,
  validateGearIndex,
  validateGearClass
} from './schema.js';
import { logger } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../data/content');

// Process-wide singleton so commands/services share one validated, indexed copy.
let _cache = null;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Read an optional JSON file: returns null when it doesn't exist (ENOENT). */
async function readOptionalJson(file) {
  try {
    return await readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** In strict mode throw (fail loud); otherwise log and let the caller continue. */
function fail(strict, msg) {
  if (strict) throw new Error(msg);
  logger.error(msg);
}

/**
 * Load the optional gear namespace: `gear/index.json` (slot ordering + shared /
 * cross-class items) plus a per-class `gear/<class>.json` for each roster class.
 * Beyond structural validation this does two referential guards (03-data-model.md):
 * every item's `slot` must be declared in `slots`, and item ids must be unique
 * bracket-wide (across shared and all class files). Each stored item is tagged
 * with an `owner` ('shared' or the class key) for display and BiS grouping.
 *
 * @returns {{ index, byClass, items: object[], byId: Record<string, object> }}
 */
async function loadGear(dir, key, roster, strict) {
  const gear = { index: null, byClass: {}, items: [], byId: {} };

  const gearIndex = await readOptionalJson(path.join(dir, key, 'gear', 'index.json'));
  if (!gearIndex) return gear;

  const giResult = validateGearIndex(gearIndex, `${key}/gear/index.json`);
  if (!giResult.ok) {
    fail(strict, `content ${key}/gear/index.json invalid: ${giResult.errors.join('; ')}`);
    return gear;
  }
  gear.index = gearIndex;
  const slots = gearIndex.slots;

  const addItem = (item, owner) => {
    if (slots && !slots.includes(item.slot)) {
      fail(strict, `content ${key}/gear: item "${item.id}" has undeclared slot "${item.slot}"`);
    }
    if (gear.byId[item.id]) {
      fail(strict, `content ${key}/gear: duplicate item id "${item.id}"`);
      return;
    }
    const withOwner = { ...item, owner };
    gear.byId[item.id] = withOwner;
    gear.items.push(withOwner);
  };

  for (const it of gearIndex.shared ?? []) addItem(it, 'shared');

  for (const entry of roster) {
    const gc = await readOptionalJson(path.join(dir, key, 'gear', `${entry.class}.json`));
    if (!gc) continue; // a roster class can lack a BiS list until authored
    const gcResult = validateGearClass(gc, `${key}/gear/${entry.class}.json`);
    if (!gcResult.ok) {
      fail(strict, `content ${key}/gear/${entry.class}.json invalid: ${gcResult.errors.join('; ')}`);
      continue;
    }
    if (gc.class !== entry.class) {
      fail(strict, `content ${key}/gear/${entry.class}.json class "${gc.class}" != roster "${entry.class}"`);
      continue;
    }
    gear.byClass[entry.class] = gc;
    for (const it of gc.items) addItem(it, entry.class);
  }

  return gear;
}

/**
 * Load one bracket: required meta.json plus the optional class roster and any
 * per-class detail files it lists. Detail files are optional (a class can be
 * roster-only until authored); when present, their tier must match the roster
 * (drift guard, per 03-data-model.md referential checks).
 */
async function loadBracket(dir, key, strict) {
  const meta = await readJson(path.join(dir, key, 'meta.json'));
  const metaResult = validateMeta(meta, `${key}/meta.json`);
  if (!metaResult.ok) {
    fail(strict, `content ${key}/meta.json invalid: ${metaResult.errors.join('; ')}`);
    return null;
  }

  const bracket = { meta, classes: { index: null, byClass: {} }, enchants: null, gear: null };

  const classIndex = await readOptionalJson(path.join(dir, key, 'classes', 'index.json'));
  if (classIndex) {
    const ciResult = validateClassIndex(classIndex, `${key}/classes/index.json`);
    if (!ciResult.ok) {
      fail(strict, `content ${key}/classes/index.json invalid: ${ciResult.errors.join('; ')}`);
    } else {
      bracket.classes.index = classIndex;
      for (const entry of classIndex.classes) {
        const detail = await readOptionalJson(path.join(dir, key, 'classes', `${entry.class}.json`));
        if (!detail) continue; // roster-only until a detail file is authored
        const cResult = validateClass(detail, `${key}/classes/${entry.class}.json`);
        if (!cResult.ok) {
          fail(strict, `content ${key}/classes/${entry.class}.json invalid: ${cResult.errors.join('; ')}`);
          continue;
        }
        if (detail.tier !== entry.tier) {
          fail(
            strict,
            `content ${key}/classes/${entry.class}.json tier "${detail.tier}" != roster tier "${entry.tier}"`
          );
          continue;
        }
        bracket.classes.byClass[entry.class] = detail;
      }
    }
  }

  // Optional enchants file. Beyond structural validation, referential-check that
  // every `classes[]` entry names a real roster class (03-data-model.md), the
  // same drift guard style used for class tiers above.
  const enchantsFile = await readOptionalJson(path.join(dir, key, 'enchants.json'));
  if (enchantsFile) {
    const eResult = validateEnchants(enchantsFile, `${key}/enchants.json`);
    if (!eResult.ok) {
      fail(strict, `content ${key}/enchants.json invalid: ${eResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      if (roster.size) {
        for (const ench of enchantsFile.enchants) {
          for (const cls of ench.classes) {
            if (!roster.has(cls)) {
              fail(
                strict,
                `content ${key}/enchants.json enchant "${ench.id}" references unknown class "${cls}"`
              );
            }
          }
        }
      }
      bracket.enchants = enchantsFile;
    }
  }

  // Gear namespace loads last: per-class BiS files key off the roster loaded above.
  bracket.gear = await loadGear(dir, key, bracket.classes.index?.classes ?? [], strict);

  return bracket;
}

/**
 * Load and validate the content store from disk, building in-memory indexes and
 * caching the result. `strict` fails loud (throws) on any invalid file — the dev
 * default — while `strict: false` skips the offending bracket and logs, so one
 * bad file can't take the bot down in prod (03-data-model.md §Loader & validation).
 *
 * The returned store shape:
 *   { schemaVersion,
 *     brackets: { <key>: { meta, classes: { index, byClass }, enchants,
 *                          gear: { index, byClass, items, byId } } },
 *     bracketKeys: string[] }
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
    let bracket;
    try {
      bracket = await loadBracket(dir, key, strict);
    } catch (err) {
      if (strict) throw err;
      logger.error({ err, bracket: key }, 'content: failed to load bracket');
      continue;
    }
    if (bracket) brackets[key] = bracket;
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

/** The `{ index, byClass }` class bundle for a bracket, or null if absent. */
export function bracketClasses(store, bracket) {
  return store?.brackets?.[bracket]?.classes ?? null;
}

/** Ordered class keys from a bracket's roster (for /tierlist and autocomplete). */
export function listClassNames(store, bracket) {
  const classes = bracketClasses(store, bracket);
  return classes?.index ? classes.index.classes.map((e) => e.class) : [];
}

/**
 * Resolve a class for display: prefer the full detail file, fall back to the
 * lightweight roster entry, or null if the bracket doesn't list it.
 */
export function getClass(store, bracket, className) {
  const classes = bracketClasses(store, bracket);
  if (!classes) return null;
  const key = String(className ?? '').toLowerCase();
  return classes.byClass[key] ?? classes.index?.classes.find((e) => e.class === key) ?? null;
}

/** The `{ note, enchants }` bundle for a bracket, or null if none is authored. */
export function bracketEnchants(store, bracket) {
  return store?.brackets?.[bracket]?.enchants ?? null;
}

/** Distinct enchant slots for a bracket, first-seen order (for slot autocomplete). */
export function listEnchantSlots(store, bracket) {
  const data = bracketEnchants(store, bracket);
  if (!data) return [];
  return [...new Set(data.enchants.map((e) => e.slot))];
}

/** The gear bundle `{ index, byClass, items, byId }` for a bracket, or null. */
export function bracketGear(store, bracket) {
  return store?.brackets?.[bracket]?.gear ?? null;
}

/** Ordered gear slots declared by a bracket's gear index (for slot autocomplete). */
export function gearSlots(store, bracket) {
  return bracketGear(store, bracket)?.index?.slots ?? [];
}

/** Class keys that have an authored BiS list (for /bis class autocomplete). */
export function listGearClasses(store, bracket) {
  return Object.keys(bracketGear(store, bracket)?.byClass ?? {});
}

/** Every gear item in a bracket (shared + per-class), for /item name autocomplete. */
export function listGearItems(store, bracket) {
  return bracketGear(store, bracket)?.items ?? [];
}

/** A single gear item by id, or null. */
export function getGearItem(store, bracket, id) {
  const gear = bracketGear(store, bracket);
  if (!gear) return null;
  return gear.byId[String(id ?? '')] ?? null;
}

/**
 * A class's best-in-slot picks: the shared cross-class items merged with the
 * class's own list, or null if that class has no authored BiS. Shared items come
 * first so faction trinkets/rings sit alongside class-specific gear per slot.
 */
export function gearForClass(store, bracket, className) {
  const gear = bracketGear(store, bracket);
  if (!gear) return null;
  const key = String(className ?? '').toLowerCase();
  if (!gear.byClass[key]) return null;
  const shared = gear.items.filter((i) => i.owner === 'shared');
  const own = gear.items.filter((i) => i.owner === key);
  return { className: key, items: [...shared, ...own] };
}
