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
  validateGearClass,
  validateScaling,
  validatePets,
  validateSpellCoefficients,
  validateConsumables,
  validateQuests,
  validateGuideIndex,
  validateGuide
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
 * Per-class files may also carry role `builds[]` (multi-loadout model): these are
 * collected owner-tagged into `builds` / `buildsByClass`; their referential guards
 * (picks resolve, one default per class) run in loadBracket, which also has the
 * enchants file loaded.
 *
 * @returns {{ index, byClass, items: object[], byId: Record<string, object>,
 *             builds: object[], buildsByClass: Record<string, object[]> }}
 */
async function loadGear(dir, key, roster, strict) {
  const gear = { index: null, byClass: {}, items: [], byId: {}, builds: [], buildsByClass: {} };

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
    if (Array.isArray(gc.builds)) {
      gear.buildsByClass[entry.class] = gc.builds;
      for (const b of gc.builds) gear.builds.push({ ...b, owner: entry.class });
    }
  }

  return gear;
}

/**
 * Load the optional guides namespace: `guides/index.json` (the slug + title +
 * summary catalogue) plus an optional `guides/<slug>.json` body per entry.
 * Referential guards (03-data-model.md): a guide's optional `class` must name a
 * real roster class, and a body file's `slug` must match its index entry. A slug
 * can be catalogued before its body is authored (like a roster-only class), in
 * which case it browses but can't yet be opened.
 *
 * @returns {{ note: string|null, list: object[], bySlug: Record<string, object> } | null}
 */
async function loadGuides(dir, key, roster, strict) {
  const guidesIndex = await readOptionalJson(path.join(dir, key, 'guides', 'index.json'));
  if (!guidesIndex) return null;

  const giResult = validateGuideIndex(guidesIndex, `${key}/guides/index.json`);
  if (!giResult.ok) {
    fail(strict, `content ${key}/guides/index.json invalid: ${giResult.errors.join('; ')}`);
    return null;
  }

  const rosterSet = new Set(roster.map((e) => e.class));
  const out = { note: guidesIndex.note ?? null, list: guidesIndex.guides, bySlug: {} };

  for (const entry of guidesIndex.guides) {
    if (rosterSet.size && entry.class != null && !rosterSet.has(entry.class)) {
      fail(strict, `content ${key}/guides/index.json guide "${entry.slug}" references unknown class "${entry.class}"`);
    }
    const body = await readOptionalJson(path.join(dir, key, 'guides', `${entry.slug}.json`));
    if (!body) continue; // catalogued but not yet authored
    const bResult = validateGuide(body, `${key}/guides/${entry.slug}.json`);
    if (!bResult.ok) {
      fail(strict, `content ${key}/guides/${entry.slug}.json invalid: ${bResult.errors.join('; ')}`);
      continue;
    }
    if (body.slug !== entry.slug) {
      fail(strict, `content ${key}/guides/${entry.slug}.json slug "${body.slug}" != index slug "${entry.slug}"`);
      continue;
    }
    if (rosterSet.size && body.class != null && !rosterSet.has(body.class)) {
      fail(strict, `content ${key}/guides/${entry.slug}.json references unknown class "${body.class}"`);
    }
    out.bySlug[entry.slug] = body;
  }

  return out;
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

  const bracket = { meta, classes: { index: null, byClass: {} }, enchants: null, gear: null, scaling: null, pets: null, spellcoef: null, consumables: null, quests: null, guides: null };

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

  // Referential guards for enriched item detail (03-data-model.md): a recommended
  // `enchant` must name a real enchant in this bracket, and every `alternatives`
  // entry must resolve to another gear item (never itself). Runs here because it
  // needs both the gear index and the enchants file loaded above.
  if (bracket.gear?.items?.length) {
    const enchantIds = new Set((bracket.enchants?.enchants ?? []).map((e) => e.id));
    for (const item of bracket.gear.items) {
      if (item.enchant != null && enchantIds.size && !enchantIds.has(item.enchant)) {
        fail(strict, `content ${key}/gear: item "${item.id}" references unknown enchant "${item.enchant}"`);
      }
      for (const alt of item.alternatives ?? []) {
        if (alt === item.id) {
          fail(strict, `content ${key}/gear: item "${item.id}" lists itself as an alternative`);
        } else if (!bracket.gear.byId[alt]) {
          fail(strict, `content ${key}/gear: item "${item.id}" references unknown alternative "${alt}"`);
        }
      }
    }
  }

  // Armor-proficiency guards (WSG-19 vetting) — the cross-file half of the check
  // the per-item schema can't see. The schema proves each armor-slot item has a
  // valid armorType; here we prove the index's `armorProficiency` map only names
  // real roster classes, every item's gating armorType is actually mapped (else
  // the /gear proficiency filter would silently hide it from *every* class), and
  // no item requires a level above the bracket cap (the bug that let a reqLevel-43
  // gun sit in a level-19 list). Fails loud in dev so bad new data can't ship.
  if (bracket.gear?.index) {
    const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
    const prof = bracket.gear.index.armorProficiency ?? {};
    const mappedTypes = new Set(Object.keys(prof));
    if (roster.size) {
      for (const [type, classes] of Object.entries(prof)) {
        for (const cls of classes) {
          if (!roster.has(cls)) {
            fail(strict, `content ${key}/gear/index.json armorProficiency.${type} references unknown class "${cls}"`);
          }
        }
      }
    }
    const levelCap = bracket.meta?.levelCap;
    for (const item of bracket.gear.items ?? []) {
      if (item.reqLevel != null && Number.isInteger(levelCap) && item.reqLevel > levelCap) {
        fail(strict, `content ${key}/gear: item "${item.id}" reqLevel ${item.reqLevel} exceeds bracket levelCap ${levelCap}`);
      }
      if (item.armorType && item.armorType !== 'misc' && mappedTypes.size && !mappedTypes.has(item.armorType)) {
        fail(strict, `content ${key}/gear: item "${item.id}" armorType "${item.armorType}" is not mapped in armorProficiency`);
      }
    }
  }

  // Referential guards for gear builds (multi-loadout model, 03/09 docs): every
  // build slot pick resolves to a shared or same-class item whose declared slot
  // matches the key, every non-null enchant resolves to a real enchant, every
  // slot key is declared, build ids are unique bracket-wide, and each class has
  // exactly one default build. Runs here because it needs the gear index, the
  // full item map, and the enchants file all loaded.
  if (bracket.gear?.builds?.length) {
    const declaredSlots = new Set(bracket.gear.index?.slots ?? []);
    const enchantIds = new Set((bracket.enchants?.enchants ?? []).map((e) => e.id));
    const byId = bracket.gear.byId;
    const seenBuildIds = new Set();
    for (const build of bracket.gear.builds) {
      if (seenBuildIds.has(build.id)) {
        fail(strict, `content ${key}/gear: duplicate build id "${build.id}"`);
      }
      seenBuildIds.add(build.id);
      for (const [slot, val] of Object.entries(build.slots)) {
        if (declaredSlots.size && !declaredSlots.has(slot)) {
          fail(strict, `content ${key}/gear: build "${build.id}" references undeclared slot "${slot}"`);
        }
        const picks = Array.isArray(val) ? val : [val];
        for (const pick of picks) {
          const item = byId[pick.item];
          if (!item) {
            fail(strict, `content ${key}/gear: build "${build.id}" slot "${slot}" references unknown item "${pick.item}"`);
          } else {
            if (item.owner !== 'shared' && item.owner !== build.owner) {
              fail(strict, `content ${key}/gear: build "${build.id}" slot "${slot}" references item "${pick.item}" owned by "${item.owner}"`);
            }
            if (item.slot !== slot) {
              fail(strict, `content ${key}/gear: build "${build.id}" places "${pick.item}" (slot "${item.slot}") in slot "${slot}"`);
            }
          }
          if (pick.enchant != null && enchantIds.size && !enchantIds.has(pick.enchant)) {
            fail(strict, `content ${key}/gear: build "${build.id}" slot "${slot}" references unknown enchant "${pick.enchant}"`);
          }
        }
      }
    }
    for (const [cls, builds] of Object.entries(bracket.gear.buildsByClass)) {
      const defaults = builds.filter((b) => b.default === true);
      if (defaults.length !== 1) {
        fail(strict, `content ${key}/gear: class "${cls}" must have exactly one default build (has ${defaults.length})`);
      }
    }
  }

  // Optional scaling file (stat conversions + per-class priority overrides)
  // backing /statweights. Referential guards mirror the enchant style: every
  // `classes` key is a real roster class, every priority names a declared stat.
  const scalingFile = await readOptionalJson(path.join(dir, key, 'scaling.json'));
  if (scalingFile) {
    const sResult = validateScaling(scalingFile, `${key}/scaling.json`);
    if (!sResult.ok) {
      fail(strict, `content ${key}/scaling.json invalid: ${sResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      const statKeys = new Set(Object.keys(scalingFile.stats ?? {}));
      for (const [cls, entry] of Object.entries(scalingFile.classes)) {
        if (roster.size && !roster.has(cls)) {
          fail(strict, `content ${key}/scaling.json references unknown class "${cls}"`);
        }
        for (const stat of entry.priority) {
          if (!statKeys.has(stat)) {
            fail(strict, `content ${key}/scaling.json class "${cls}" priority references unknown stat "${stat}"`);
          }
        }
      }
      bracket.scaling = scalingFile;
    }
  }

  // Optional pets file (hunter class-extra) backing /pets. Referential guard
  // mirrors the others: its `class` must be a real roster class.
  const petsFile = await readOptionalJson(path.join(dir, key, 'pets.json'));
  if (petsFile) {
    const pResult = validatePets(petsFile, `${key}/pets.json`);
    if (!pResult.ok) {
      fail(strict, `content ${key}/pets.json invalid: ${pResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      if (roster.size && !roster.has(petsFile.class)) {
        fail(strict, `content ${key}/pets.json references unknown class "${petsFile.class}"`);
      }
      bracket.pets = petsFile;
    }
  }

  // Optional spell-coefficient file backing /spellcoef. Referential guard mirrors
  // the others: every `byClass` key must be a real roster class (03-data-model.md).
  const spellcoefFile = await readOptionalJson(path.join(dir, key, 'spellcoefficients.json'));
  if (spellcoefFile) {
    const scResult = validateSpellCoefficients(spellcoefFile, `${key}/spellcoefficients.json`);
    if (!scResult.ok) {
      fail(strict, `content ${key}/spellcoefficients.json invalid: ${scResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      if (roster.size) {
        for (const cls of Object.keys(spellcoefFile.byClass)) {
          if (!roster.has(cls)) {
            fail(strict, `content ${key}/spellcoefficients.json references unknown class "${cls}"`);
          }
        }
      }
      bracket.spellcoef = spellcoefFile;
    }
  }

  // Optional consumables file backing /consumable. Referential guard: every
  // entry's optional `classes[]` must name a real roster class (03-data-model.md).
  const consumablesFile = await readOptionalJson(path.join(dir, key, 'consumables.json'));
  if (consumablesFile) {
    const cResult = validateConsumables(consumablesFile, `${key}/consumables.json`);
    if (!cResult.ok) {
      fail(strict, `content ${key}/consumables.json invalid: ${cResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      if (roster.size) {
        for (const c of consumablesFile.consumables) {
          for (const cls of c.classes ?? []) {
            if (!roster.has(cls)) {
              fail(strict, `content ${key}/consumables.json consumable "${c.id}" references unknown class "${cls}"`);
            }
          }
        }
      }
      bracket.consumables = consumablesFile;
    }
  }

  // Optional quests file backing /quest. Two referential guards (03-data-model.md):
  // every reward `itemId` resolves to a real gear item in this bracket, and every
  // optional `classes[]` entry names a real roster class. Runs after gear loads.
  const questsFile = await readOptionalJson(path.join(dir, key, 'quests.json'));
  if (questsFile) {
    const qResult = validateQuests(questsFile, `${key}/quests.json`);
    if (!qResult.ok) {
      fail(strict, `content ${key}/quests.json invalid: ${qResult.errors.join('; ')}`);
    } else {
      const roster = new Set((bracket.classes.index?.classes ?? []).map((e) => e.class));
      const gearIds = bracket.gear?.byId ?? {};
      for (const q of questsFile.quests) {
        if (q.reward?.itemId != null && Object.keys(gearIds).length && !gearIds[q.reward.itemId]) {
          fail(strict, `content ${key}/quests.json quest "${q.id}" reward references unknown item "${q.reward.itemId}"`);
        }
        if (roster.size) {
          for (const cls of q.classes ?? []) {
            if (!roster.has(cls)) {
              fail(strict, `content ${key}/quests.json quest "${q.id}" references unknown class "${cls}"`);
            }
          }
        }
      }
      bracket.quests = questsFile;
    }
  }

  // Optional guides namespace loads last: its catalogue + bodies key off the
  // roster loaded above (a guide's `class` must be a real roster class). See
  // loadGuides for the referential guards.
  bracket.guides = await loadGuides(dir, key, bracket.classes.index?.classes ?? [], strict);

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

/**
 * Force a fresh strict reload from disk for the dev /reloadcontent command.
 * A strict load throws on the first invalid/parse error, and it does so before
 * loadContentStore reassigns the singleton — so a bad edit surfaces the error
 * while the last-good store keeps serving. Never throws: it returns a result.
 *
 * @param {{ dir?: string }} [opts]
 * @returns {Promise<{ ok: true, store: object } | { ok: false, error: Error }>}
 */
export async function reloadContentStore(opts = {}) {
  try {
    const store = await loadContentStore({ ...opts, strict: true });
    return { ok: true, store };
  } catch (error) {
    return { ok: false, error };
  }
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

/** A single enchant by id, or null (used to resolve an item's recommended enchant). */
export function getEnchant(store, bracket, id) {
  const data = bracketEnchants(store, bracket);
  if (!data) return null;
  return data.enchants.find((e) => e.id === String(id ?? '')) ?? null;
}

/** Distinct enchant slots for a bracket, first-seen order (for slot autocomplete). */
export function listEnchantSlots(store, bracket) {
  const data = bracketEnchants(store, bracket);
  if (!data) return [];
  return [...new Set(data.enchants.map((e) => e.slot))];
}

/** The gear bundle `{ index, byClass, items, byId, builds, buildsByClass }`, or null. */
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
 * Can class `key` equip `item`? Non-armor slots and armor pieces marked `misc`
 * (proficiency-agnostic, e.g. a fishing hat) are worn by everyone; a gating
 * material type (cloth/leather/mail/plate) is only wearable by the classes the
 * gear index's `armorProficiency` map lists for it. This is what stops the
 * shared/browse pool from showing mail to a cloth class (WSG-19 vetting).
 */
function classCanEquip(prof, key, item) {
  if (!item.armorType || item.armorType === 'misc') return true;
  return (prof[item.armorType] ?? []).includes(key);
}

/**
 * A class's best-in-slot picks: the shared cross-class items merged with the
 * class's own list, or null if that class has no authored BiS. Shared items come
 * first so faction trinkets/rings sit alongside class-specific gear per slot.
 *
 * Items the class can't equip by armor proficiency are filtered out, so the
 * browse pool (`/gear`, `/bis`) never surfaces mail/leather/plate a class can't
 * wear. Explicit build picks bypass this — a strict load already proves every
 * pick is equippable — so role loadouts render exactly as authored.
 */
export function gearForClass(store, bracket, className) {
  const gear = bracketGear(store, bracket);
  if (!gear) return null;
  const key = String(className ?? '').toLowerCase();
  if (!gear.byClass[key]) return null;
  const prof = gear.index?.armorProficiency ?? {};
  const shared = gear.items.filter((i) => i.owner === 'shared' && classCanEquip(prof, key, i));
  const own = gear.items.filter((i) => i.owner === key && classCanEquip(prof, key, i));
  return { className: key, items: [...shared, ...own] };
}

/**
 * The role builds authored for a class (owner-tagged, multi-loadout model), or []
 * if the class has none. Each build's `slots` map references item ids resolved via
 * `getGearItem` and enchant ids via `getEnchant` (a strict load proves they exist).
 */
export function buildsForClass(store, bracket, className) {
  const gear = bracketGear(store, bracket);
  if (!gear) return [];
  const key = String(className ?? '').toLowerCase();
  return gear.builds.filter((b) => b.owner === key);
}

/** A single gear build by id (owner-tagged), or null. */
export function getBuild(store, bracket, buildId) {
  const gear = bracketGear(store, bracket);
  if (!gear) return null;
  return gear.builds.find((b) => b.id === String(buildId ?? '')) ?? null;
}

/** The scaling bundle (stats/derived/hitCaps/classes) for a bracket, or null. */
export function bracketScaling(store, bracket) {
  return store?.brackets?.[bracket]?.scaling ?? null;
}

/** Class keys that have a stat-weight override (for /statweights autocomplete). */
export function listStatweightClasses(store, bracket) {
  return Object.keys(bracketScaling(store, bracket)?.classes ?? {});
}

/**
 * A class's stat-weight view: its priority/notes override plus the shared scaling
 * bundle (stats, derived formulas, hit caps), or null if the class has none.
 */
export function statweightsForClass(store, bracket, className) {
  const scaling = bracketScaling(store, bracket);
  if (!scaling) return null;
  const key = String(className ?? '').toLowerCase();
  const entry = scaling.classes[key];
  if (!entry) return null;
  return { className: key, entry, scaling };
}

/** The pets bundle (families + xp/ability/budget notes) for a bracket, or null. */
export function bracketPets(store, bracket) {
  return store?.brackets?.[bracket]?.pets ?? null;
}

/** Pet family keys authored for a bracket (for /pets family autocomplete). */
export function listPetFamilies(store, bracket) {
  return (bracketPets(store, bracket)?.families ?? []).map((f) => f.family);
}

/** A single pet family entry by key, or null. */
export function getPetFamily(store, bracket, family) {
  const pets = bracketPets(store, bracket);
  if (!pets) return null;
  const key = String(family ?? '').toLowerCase();
  return pets.families.find((f) => f.family === key) ?? null;
}

/** The spell-coefficient bundle (`{ penalty, byClass }`) for a bracket, or null. */
export function bracketSpellcoef(store, bracket) {
  return store?.brackets?.[bracket]?.spellcoef ?? null;
}

/** Class keys with authored spell coefficients (for /spellcoef autocomplete). */
export function listSpellcoefClasses(store, bracket) {
  return Object.keys(bracketSpellcoef(store, bracket)?.byClass ?? {});
}

/** A class's spell list (each `{ spell, rank, coefficient, type, ... }`), or null. */
export function spellcoefForClass(store, bracket, className) {
  const data = bracketSpellcoef(store, bracket);
  if (!data) return null;
  const key = String(className ?? '').toLowerCase();
  return data.byClass[key] ?? null;
}

/** The consumables bundle (`{ note, consumables }`) for a bracket, or null. */
export function bracketConsumables(store, bracket) {
  return store?.brackets?.[bracket]?.consumables ?? null;
}

/** Distinct consumable types present in a bracket, first-seen order (for reference). */
export function listConsumableTypes(store, bracket) {
  const data = bracketConsumables(store, bracket);
  if (!data) return [];
  return [...new Set(data.consumables.map((c) => c.type))];
}

/**
 * Consumables for a bracket, optionally filtered by `type` and/or `className`.
 * A class filter keeps entries that either name the class in `classes` or have
 * no `classes` at all (universal consumables). Returns [] when none are loaded.
 */
export function consumablesFor(store, bracket, { type = null, className = null } = {}) {
  const data = bracketConsumables(store, bracket);
  if (!data) return [];
  const typeKey = type ? String(type).toLowerCase() : null;
  const classKey = className ? String(className).toLowerCase() : null;
  return data.consumables.filter(
    (c) =>
      (!typeKey || c.type === typeKey) &&
      (!classKey || !c.classes || c.classes.some((cl) => cl.toLowerCase() === classKey))
  );
}

/** The quests bundle (`{ note, quests }`) for a bracket, or null. */
export function bracketQuests(store, bracket) {
  return store?.brackets?.[bracket]?.quests ?? null;
}

/**
 * Quests for a bracket, optionally filtered by `faction` and/or `className`. A
 * faction filter keeps quests of that faction plus `both`; a class filter keeps
 * quests that either name the class in `classes` or have none (universal). Returns
 * [] when none are loaded.
 */
export function questsFor(store, bracket, { faction = null, className = null } = {}) {
  const data = bracketQuests(store, bracket);
  if (!data) return [];
  const factionKey = faction ? String(faction).toLowerCase() : null;
  const classKey = className ? String(className).toLowerCase() : null;
  return data.quests.filter(
    (q) =>
      (!factionKey || q.faction === factionKey || q.faction === 'both') &&
      (!classKey || !q.classes || q.classes.some((cl) => cl.toLowerCase() === classKey))
  );
}

/** The guides bundle (`{ note, list, bySlug }`) for a bracket, or null. */
export function bracketGuides(store, bracket) {
  return store?.brackets?.[bracket]?.guides ?? null;
}

/** The guide catalogue (index entries) for a bracket (for /guide autocomplete/browse). */
export function listGuides(store, bracket) {
  return bracketGuides(store, bracket)?.list ?? [];
}

/** A single guide body by slug, or null (only slugs whose body file is authored). */
export function getGuide(store, bracket, slug) {
  const guides = bracketGuides(store, bracket);
  if (!guides) return null;
  return guides.bySlug[String(slug ?? '').toLowerCase()] ?? null;
}

/**
 * Guide catalogue entries filtered by `className` and/or `tag`. A class filter
 * keeps guides that either name the class or have none (universal); a tag filter
 * keeps guides whose `tags` include it. Returns [] when none are loaded.
 */
export function guidesFor(store, bracket, { className = null, tag = null } = {}) {
  const list = listGuides(store, bracket);
  const classKey = className ? String(className).toLowerCase() : null;
  const tagKey = tag ? String(tag).toLowerCase() : null;
  return list.filter(
    (g) =>
      (!classKey || g.class == null || String(g.class).toLowerCase() === classKey) &&
      (!tagKey || (g.tags ?? []).some((t) => t.toLowerCase() === tagKey))
  );
}

/**
 * A compact per-bracket count summary — `{ bracket, classes, enchants, gearItems,
 * scalingClasses }` per bracket — for the /reloadcontent report and quick health
 * checks. Reads through the same accessors the commands use.
 */
export function summarizeStore(store) {
  return (store?.bracketKeys ?? []).map((bracket) => ({
    bracket,
    classes: listClassNames(store, bracket).length,
    enchants: bracketEnchants(store, bracket)?.enchants.length ?? 0,
    gearItems: listGearItems(store, bracket).length,
    scalingClasses: listStatweightClasses(store, bracket).length,
    guides: listGuides(store, bracket).length
  }));
}
