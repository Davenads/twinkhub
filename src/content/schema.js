/**
 * Lightweight, dependency-free content validation.
 *
 * 03-data-model.md suggests zod/ajv; we keep the codebase's zero-dependency norm
 * and hand-roll a small declarative validator that enforces the same structural
 * and game-version gates. The shape is intentionally simple so a later swap to
 * zod/ajv stays localized to this module. Each validator returns
 * `{ ok: boolean, errors: string[] }` rather than throwing, so the loader can
 * decide (fail-loud in dev vs. degrade in prod).
 */

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isInteger = (v) => Number.isInteger(v);
const isBoolean = (v) => typeof v === 'boolean';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Controlled vocabularies for gear items (03-data-model.md).
const SOURCE_TYPES = ['drop', 'quest', 'vendor', 'profession', 'pvp', 'world', 'boe'];
const FACTIONS = ['alliance', 'horde', 'both'];
const PRIORITIES = ['core', 'situational', 'budget'];

// Controlled spell-coefficient effect types (03-data-model.md). For dot/hot/proc
// the coefficient is per tick/hit/orb rather than per cast.
const SPELL_TYPES = ['direct-damage', 'dot', 'direct-heal', 'hot', 'shield', 'proc'];

// Controlled consumable types (03-data-model.md) — the same five `/consumable type:` exposes.
const CONSUMABLE_TYPES = ['potion', 'poison', 'food', 'explosive', 'worldbuff'];

/** Record `msg` when `cond` is false; returns `cond` for control flow. */
function require_(errors, cond, msg) {
  if (!cond) errors.push(msg);
  return cond;
}

/** `data/content/index.json`: registry of present brackets + schema version. */
export function validateIndex(obj) {
  const errors = [];
  if (require_(errors, isObject(obj), 'index.json: must be an object')) {
    require_(errors, isInteger(obj.schemaVersion), 'index.json: schemaVersion must be an integer');
    require_(
      errors,
      Array.isArray(obj.brackets) &&
        obj.brackets.length > 0 &&
        obj.brackets.every(isNonEmptyString),
      'index.json: brackets must be a non-empty array of bracket keys'
    );
  }
  return { ok: errors.length === 0, errors };
}

/** `<bracket>/meta.json`: bracket rules (level cap, XP rules, BG, game version). */
export function validateMeta(obj, label = 'meta.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }

  require_(errors, isNonEmptyString(obj.bracket), `${label}: bracket must be a non-empty string`);
  require_(errors, isInteger(obj.levelCap), `${label}: levelCap must be an integer`);
  require_(
    errors,
    Array.isArray(obj.levelRange) &&
      obj.levelRange.length === 2 &&
      obj.levelRange.every(isInteger),
    `${label}: levelRange must be a [min, max] integer pair`
  );
  require_(
    errors,
    isNonEmptyString(obj.battleground),
    `${label}: battleground must be a non-empty string`
  );

  if (require_(errors, isObject(obj.xpLock), `${label}: xpLock must be an object`)) {
    require_(errors, isBoolean(obj.xpLock.available), `${label}: xpLock.available must be a boolean`);
    require_(errors, isNonEmptyString(obj.xpLock.note), `${label}: xpLock.note must be a non-empty string`);
  }

  if (require_(errors, isObject(obj.gameVersion), `${label}: gameVersion must be an object`)) {
    // Game-version gate (03-data-model.md): guards against SoD / TBC / Anniversary
    // content creeping into a Classic Era store.
    require_(
      errors,
      obj.gameVersion.flavor === 'classic-era',
      `${label}: gameVersion.flavor must be "classic-era"`
    );
    require_(
      errors,
      obj.gameVersion.contentState === 'all-pre-tbc-unlocked',
      `${label}: gameVersion.contentState must be "all-pre-tbc-unlocked"`
    );
  }

  return { ok: errors.length === 0, errors };
}

const isStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);

/** `<bracket>/classes/index.json`: the tier roster driving /tierlist. */
export function validateClassIndex(obj, label = 'classes/index.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  if (
    require_(
      errors,
      Array.isArray(obj.classes) && obj.classes.length > 0,
      `${label}: classes must be a non-empty array`
    )
  ) {
    const seen = new Set();
    obj.classes.forEach((entry, i) => {
      const at = `${label}: classes[${i}]`;
      require_(errors, isNonEmptyString(entry?.class), `${at}.class must be a non-empty string`);
      require_(errors, isNonEmptyString(entry?.tier), `${at}.tier must be a non-empty string`);
      require_(errors, isStringArray(entry?.roles), `${at}.roles must be a non-empty string array`);
      require_(errors, isNonEmptyString(entry?.summary), `${at}.summary must be a non-empty string`);
      if (isNonEmptyString(entry?.class)) {
        require_(errors, !seen.has(entry.class), `${at}.class "${entry.class}" is duplicated`);
        seen.add(entry.class);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/** `<bracket>/classes/<class>.json`: full per-class detail. */
export function validateClass(obj, label = 'class') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  require_(errors, isNonEmptyString(obj.class), `${label}: class must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.tier), `${label}: tier must be a non-empty string`);
  require_(errors, isStringArray(obj.roles), `${label}: roles must be a non-empty string array`);
  require_(errors, isNonEmptyString(obj.summary), `${label}: summary must be a non-empty string`);

  if (require_(errors, Array.isArray(obj.specs) && obj.specs.length > 0, `${label}: specs must be a non-empty array`)) {
    obj.specs.forEach((spec, i) => {
      const at = `${label}: specs[${i}]`;
      require_(errors, isNonEmptyString(spec?.name), `${at}.name must be a non-empty string`);
      require_(errors, isStringArray(spec?.statPriority), `${at}.statPriority must be a non-empty string array`);
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/enchants.json`: enchants usable at this bracket. Structural checks
 * only — the referential guard (every `classes[]` is a real roster class) lives
 * in the store, which alone holds the loaded class index (03-data-model.md).
 * `noLevelReq` is a required first-class flag: the entire twink enchant meta
 * hinges on enchants that ignore the item's level requirement.
 */
export function validateEnchants(obj, label = 'enchants.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  if (obj.note !== undefined) {
    require_(errors, isNonEmptyString(obj.note), `${label}: note must be a non-empty string when present`);
  }
  if (
    require_(
      errors,
      Array.isArray(obj.enchants) && obj.enchants.length > 0,
      `${label}: enchants must be a non-empty array`
    )
  ) {
    const seen = new Set();
    obj.enchants.forEach((entry, i) => {
      const at = `${label}: enchants[${i}]`;
      require_(errors, isNonEmptyString(entry?.id), `${at}.id must be a non-empty string`);
      require_(errors, isNonEmptyString(entry?.name), `${at}.name must be a non-empty string`);
      require_(errors, isNonEmptyString(entry?.slot), `${at}.slot must be a non-empty string`);
      require_(errors, isNonEmptyString(entry?.effect), `${at}.effect must be a non-empty string`);
      require_(errors, isBoolean(entry?.noLevelReq), `${at}.noLevelReq must be a boolean`);
      require_(
        errors,
        entry?.reqLevel == null || isInteger(entry.reqLevel),
        `${at}.reqLevel must be an integer or null`
      );
      require_(errors, isStringArray(entry?.classes), `${at}.classes must be a non-empty string array`);
      if (isNonEmptyString(entry?.id)) {
        require_(errors, !seen.has(entry.id), `${at}.id "${entry.id}" is duplicated`);
        seen.add(entry.id);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate one gear item into a shared `errors` array (used by both gear
 * validators so array items report with their index). Enforces the controlled
 * source/faction/priority vocabularies; `stats`, `reqLevel`, and `wowheadId` are
 * optional so items can be authored before every number is verified.
 */
function validateItem(obj, at, errors) {
  if (!require_(errors, isObject(obj), `${at}: must be an object`)) return;
  require_(errors, isNonEmptyString(obj.id), `${at}.id must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.name), `${at}.name must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.slot), `${at}.slot must be a non-empty string`);
  require_(errors, FACTIONS.includes(obj.faction), `${at}.faction must be one of ${FACTIONS.join('|')}`);
  require_(errors, PRIORITIES.includes(obj.priority), `${at}.priority must be one of ${PRIORITIES.join('|')}`);
  if (require_(errors, isObject(obj.source), `${at}.source must be an object`)) {
    require_(
      errors,
      SOURCE_TYPES.includes(obj.source.type),
      `${at}.source.type must be one of ${SOURCE_TYPES.join('|')}`
    );
    require_(errors, isNonEmptyString(obj.source.detail), `${at}.source.detail must be a non-empty string`);
  }
  require_(errors, obj.reqLevel == null || isInteger(obj.reqLevel), `${at}.reqLevel must be an integer or null`);
  if (obj.wowheadId !== undefined) {
    require_(
      errors,
      obj.wowheadId === null || isInteger(obj.wowheadId),
      `${at}.wowheadId must be an integer or null`
    );
  }
  if (obj.stats !== undefined && require_(errors, isObject(obj.stats), `${at}.stats must be an object`)) {
    for (const [k, v] of Object.entries(obj.stats)) {
      require_(errors, isInteger(v), `${at}.stats.${k} must be an integer`);
    }
  }
  // Rich detail (P3): an optional recommended-enchant reference and alternative
  // item ids. These are structural type checks only — the referential guards
  // (enchant id is real, alternative ids resolve) live in the store, which sees
  // the whole bracket at once (03-data-model.md).
  if (obj.enchant !== undefined) {
    require_(errors, isNonEmptyString(obj.enchant), `${at}.enchant must be a non-empty string when present`);
  }
  if (obj.alternatives !== undefined) {
    require_(errors, isStringArray(obj.alternatives), `${at}.alternatives must be a non-empty string array when present`);
  }
}

/**
 * `<bracket>/gear/index.json`: the slot ordering plus optional cross-class
 * (shared / BoE) items. Item slots and bracket-wide id uniqueness are checked in
 * the store, which sees every gear file at once (03-data-model.md).
 */
export function validateGearIndex(obj, label = 'gear/index.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  require_(errors, isStringArray(obj.slots), `${label}: slots must be a non-empty string array`);
  if (obj.notes !== undefined) {
    require_(errors, isNonEmptyString(obj.notes), `${label}: notes must be a non-empty string when present`);
  }
  if (obj.shared !== undefined && require_(errors, Array.isArray(obj.shared), `${label}: shared must be an array`)) {
    const seen = new Set();
    obj.shared.forEach((it, i) => {
      const at = `${label}: shared[${i}]`;
      validateItem(it, at, errors);
      if (isNonEmptyString(it?.id)) {
        require_(errors, !seen.has(it.id), `${at}.id "${it.id}" is duplicated`);
        seen.add(it.id);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/** `<bracket>/gear/<class>.json`: a class's best-in-slot item list. */
export function validateGearClass(obj, label = 'gear/class') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  require_(errors, isNonEmptyString(obj.class), `${label}: class must be a non-empty string`);
  if (require_(errors, Array.isArray(obj.items) && obj.items.length > 0, `${label}: items must be a non-empty array`)) {
    const seen = new Set();
    obj.items.forEach((it, i) => {
      const at = `${label}: items[${i}]`;
      validateItem(it, at, errors);
      if (isNonEmptyString(it?.id)) {
        require_(errors, !seen.has(it.id), `${at}.id "${it.id}" is duplicated`);
        seen.add(it.id);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/scaling.json`: stat conversions/formulas (constants) plus per-class
 * priority overrides, backing `/statweights`. Structural checks only — the
 * referential guards (each `classes` key is a real roster class, each priority
 * names a declared stat) live in the store, which sees the class roster too.
 */
export function validateScaling(obj, label = 'scaling.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  if (obj.note !== undefined) {
    require_(errors, isNonEmptyString(obj.note), `${label}: note must be a non-empty string when present`);
  }

  if (require_(errors, isObject(obj.stats), `${label}: stats must be an object`)) {
    const keys = Object.keys(obj.stats);
    require_(errors, keys.length > 0, `${label}: stats must have at least one entry`);
    for (const [key, s] of Object.entries(obj.stats)) {
      const at = `${label}: stats.${key}`;
      if (!require_(errors, isObject(s), `${at} must be an object`)) continue;
      require_(errors, isNonEmptyString(s.label), `${at}.label must be a non-empty string`);
      require_(errors, isNonEmptyString(s.summary), `${at}.summary must be a non-empty string`);
      require_(errors, isStringArray(s.conversions), `${at}.conversions must be a non-empty string array`);
    }
  }

  if (obj.derived !== undefined && require_(errors, Array.isArray(obj.derived), `${label}: derived must be an array`)) {
    obj.derived.forEach((d, i) => {
      const at = `${label}: derived[${i}]`;
      require_(errors, isNonEmptyString(d?.name), `${at}.name must be a non-empty string`);
      require_(errors, isNonEmptyString(d?.formula), `${at}.formula must be a non-empty string`);
      if (d?.notes !== undefined) {
        require_(errors, isNonEmptyString(d.notes), `${at}.notes must be a non-empty string when present`);
      }
    });
  }

  if (obj.hitCaps !== undefined && require_(errors, Array.isArray(obj.hitCaps), `${label}: hitCaps must be an array`)) {
    obj.hitCaps.forEach((h, i) => {
      const at = `${label}: hitCaps[${i}]`;
      require_(errors, isNonEmptyString(h?.type), `${at}.type must be a non-empty string`);
      require_(errors, isNonEmptyString(h?.value), `${at}.value must be a non-empty string`);
    });
  }

  if (require_(errors, isObject(obj.classes), `${label}: classes must be an object`)) {
    const keys = Object.keys(obj.classes);
    require_(errors, keys.length > 0, `${label}: classes must have at least one entry`);
    for (const [key, c] of Object.entries(obj.classes)) {
      const at = `${label}: classes.${key}`;
      if (!require_(errors, isObject(c), `${at} must be an object`)) continue;
      require_(errors, isStringArray(c.priority), `${at}.priority must be a non-empty string array`);
      require_(errors, isStringArray(c.notes), `${at}.notes must be a non-empty string array`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/pets.json`: hunter pet families plus XP-management notes, backing
 * `/pets`. Structural checks only — the referential guard (`class` is a real
 * roster class) lives in the store. `keyAbility`, `tameLevel`, and `zone` are
 * nullable so a family can be authored before those specifics are verified;
 * `notes` carries the verified defining trait and any verify-at-authoring caveat.
 */
export function validatePets(obj, label = 'pets.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  require_(errors, isNonEmptyString(obj.class), `${label}: class must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.xpNote), `${label}: xpNote must be a non-empty string`);
  for (const opt of ['abilityNote', 'budgetNote']) {
    if (obj[opt] !== undefined) {
      require_(errors, isNonEmptyString(obj[opt]), `${label}: ${opt} must be a non-empty string when present`);
    }
  }

  if (
    require_(
      errors,
      Array.isArray(obj.families) && obj.families.length > 0,
      `${label}: families must be a non-empty array`
    )
  ) {
    const seen = new Set();
    obj.families.forEach((f, i) => {
      const at = `${label}: families[${i}]`;
      if (!require_(errors, isObject(f), `${at} must be an object`)) return;
      require_(errors, isNonEmptyString(f.family), `${at}.family must be a non-empty string`);
      require_(errors, isNonEmptyString(f.exampleName), `${at}.exampleName must be a non-empty string`);
      require_(errors, isNonEmptyString(f.notes), `${at}.notes must be a non-empty string`);
      if (f.keyAbility != null) {
        require_(errors, isNonEmptyString(f.keyAbility), `${at}.keyAbility must be a non-empty string or null`);
      }
      if (f.zone != null) {
        require_(errors, isNonEmptyString(f.zone), `${at}.zone must be a non-empty string or null`);
      }
      if (f.tameLevel != null) {
        require_(errors, isInteger(f.tameLevel), `${at}.tameLevel must be an integer or null`);
      }
      if (f.attackSpeed !== undefined) {
        require_(errors, typeof f.attackSpeed === 'number', `${at}.attackSpeed must be a number when present`);
      }
      if (isNonEmptyString(f.family)) {
        require_(errors, !seen.has(f.family), `${at}.family "${f.family}" is duplicated`);
        seen.add(f.family);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/spellcoefficients.json`: level-19-effective spell power coefficients
 * per caster/hybrid spell, plus the sub-level-20 penalty constant, backing
 * `/spellcoef`. Structural checks only — the referential guard (every `byClass`
 * key is a real roster class) lives in the store. Coefficients are per cast for
 * direct-damage/heal/shield and per tick/hit/orb for dot/hot/proc; `confirmed`
 * defaults to true and is set false for values not yet Wowhead-verified so the
 * command never presents them as authoritative. Melee-only classes simply have
 * no key here.
 */
export function validateSpellCoefficients(obj, label = 'spellcoefficients.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }

  if (require_(errors, isObject(obj.penalty), `${label}: penalty must be an object`)) {
    require_(
      errors,
      typeof obj.penalty.perLevelBelow20 === 'number',
      `${label}: penalty.perLevelBelow20 must be a number`
    );
    if (obj.penalty.note !== undefined) {
      require_(errors, isNonEmptyString(obj.penalty.note), `${label}: penalty.note must be a non-empty string when present`);
    }
  }

  if (require_(errors, isObject(obj.byClass), `${label}: byClass must be an object`)) {
    const keys = Object.keys(obj.byClass);
    require_(errors, keys.length > 0, `${label}: byClass must have at least one class`);
    for (const [cls, list] of Object.entries(obj.byClass)) {
      const clsAt = `${label}: byClass.${cls}`;
      if (!require_(errors, Array.isArray(list) && list.length > 0, `${clsAt} must be a non-empty array`)) continue;
      const seen = new Set();
      list.forEach((s, i) => {
        const at = `${clsAt}[${i}]`;
        if (!require_(errors, isObject(s), `${at} must be an object`)) return;
        require_(errors, isNonEmptyString(s.spell), `${at}.spell must be a non-empty string`);
        require_(errors, isInteger(s.rank), `${at}.rank must be an integer`);
        require_(
          errors,
          typeof s.coefficient === 'number' && s.coefficient >= 0,
          `${at}.coefficient must be a number >= 0`
        );
        require_(errors, SPELL_TYPES.includes(s.type), `${at}.type must be one of ${SPELL_TYPES.join('|')}`);
        if (s.confirmed !== undefined) {
          require_(errors, isBoolean(s.confirmed), `${at}.confirmed must be a boolean when present`);
        }
        if (s.notes !== undefined) {
          require_(errors, isNonEmptyString(s.notes), `${at}.notes must be a non-empty string when present`);
        }
        // A spell can carry both a direct and a dot/hot entry at the same rank
        // (Fireball, Immolate, Moonfire), so the type is part of the identity.
        if (isNonEmptyString(s.spell) && isInteger(s.rank) && SPELL_TYPES.includes(s.type)) {
          const dupKey = `${s.spell}#${s.rank}#${s.type}`;
          require_(errors, !seen.has(dupKey), `${at} duplicates "${s.spell}" rank ${s.rank} (${s.type})`);
          seen.add(dupKey);
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/consumables.json`: potions, poisons, food, explosives, and world
 * buffs backing `/consumable`. Structural checks only — the referential guard
 * (every `classes[]` entry is a real roster class) lives in the store. `faction`,
 * `reqLevel`, `source`, `classes`, and `notes` are optional so an item can be
 * authored before every detail is verified; a missing `classes` means the
 * consumable applies to everyone (a present one makes it class-specific).
 */
export function validateConsumables(obj, label = 'consumables.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  if (obj.note !== undefined) {
    require_(errors, isNonEmptyString(obj.note), `${label}: note must be a non-empty string when present`);
  }

  if (
    require_(
      errors,
      Array.isArray(obj.consumables) && obj.consumables.length > 0,
      `${label}: consumables must be a non-empty array`
    )
  ) {
    const seen = new Set();
    obj.consumables.forEach((c, i) => {
      const at = `${label}: consumables[${i}]`;
      if (!require_(errors, isObject(c), `${at} must be an object`)) return;
      require_(errors, isNonEmptyString(c.id), `${at}.id must be a non-empty string`);
      require_(errors, isNonEmptyString(c.name), `${at}.name must be a non-empty string`);
      require_(errors, CONSUMABLE_TYPES.includes(c.type), `${at}.type must be one of ${CONSUMABLE_TYPES.join('|')}`);
      require_(errors, isNonEmptyString(c.effect), `${at}.effect must be a non-empty string`);
      if (c.faction !== undefined) {
        require_(errors, FACTIONS.includes(c.faction), `${at}.faction must be one of ${FACTIONS.join('|')}`);
      }
      if (c.reqLevel !== undefined) {
        require_(errors, c.reqLevel === null || isInteger(c.reqLevel), `${at}.reqLevel must be an integer or null`);
      }
      if (c.classes !== undefined) {
        require_(errors, isStringArray(c.classes), `${at}.classes must be a non-empty string array when present`);
      }
      if (c.source !== undefined && require_(errors, isObject(c.source), `${at}.source must be an object when present`)) {
        require_(errors, SOURCE_TYPES.includes(c.source.type), `${at}.source.type must be one of ${SOURCE_TYPES.join('|')}`);
        require_(errors, isNonEmptyString(c.source.detail), `${at}.source.detail must be a non-empty string`);
      }
      if (c.notes !== undefined) {
        require_(errors, isNonEmptyString(c.notes), `${at}.notes must be a non-empty string when present`);
      }
      if (isNonEmptyString(c.id)) {
        require_(errors, !seen.has(c.id), `${at}.id "${c.id}" is duplicated`);
        seen.add(c.id);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/quests.json`: gear-reward quests worth doing before the cap, backing
 * `/quest`. Structural checks only — the referential guards (`reward.itemId`
 * resolves to a real gear item, `classes[]` are real roster classes) live in the
 * store, which sees the gear index and roster. `reward` must carry exactly one of
 * `itemId` or `desc`. `xpWarning` is a required first-class flag: it marks turn-ins
 * that risk pushing a near-cap character to 20. `zone` is nullable and `classes`
 * optional so a quest can be authored before every detail is verified.
 */
export function validateQuests(obj, label = 'quests.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) {
    return { ok: false, errors };
  }
  if (obj.note !== undefined) {
    require_(errors, isNonEmptyString(obj.note), `${label}: note must be a non-empty string when present`);
  }

  if (
    require_(
      errors,
      Array.isArray(obj.quests) && obj.quests.length > 0,
      `${label}: quests must be a non-empty array`
    )
  ) {
    const seen = new Set();
    obj.quests.forEach((q, i) => {
      const at = `${label}: quests[${i}]`;
      if (!require_(errors, isObject(q), `${at} must be an object`)) return;
      require_(errors, isNonEmptyString(q.id), `${at}.id must be a non-empty string`);
      require_(errors, isNonEmptyString(q.name), `${at}.name must be a non-empty string`);
      require_(errors, q.zone === null || isNonEmptyString(q.zone), `${at}.zone must be a non-empty string or null`);
      require_(errors, FACTIONS.includes(q.faction), `${at}.faction must be one of ${FACTIONS.join('|')}`);
      require_(errors, isBoolean(q.xpWarning), `${at}.xpWarning must be a boolean`);
      if (require_(errors, isObject(q.reward), `${at}.reward must be an object`)) {
        const hasItem = q.reward.itemId !== undefined;
        const hasDesc = q.reward.desc !== undefined;
        require_(errors, hasItem || hasDesc, `${at}.reward must have an itemId or a desc`);
        if (hasItem) require_(errors, isNonEmptyString(q.reward.itemId), `${at}.reward.itemId must be a non-empty string`);
        if (hasDesc) require_(errors, isNonEmptyString(q.reward.desc), `${at}.reward.desc must be a non-empty string`);
      }
      if (q.classes !== undefined) {
        require_(errors, isStringArray(q.classes), `${at}.classes must be a non-empty string array when present`);
      }
      if (q.notes !== undefined) {
        require_(errors, isNonEmptyString(q.notes), `${at}.notes must be a non-empty string when present`);
      }
      if (isNonEmptyString(q.id)) {
        require_(errors, !seen.has(q.id), `${at}.id "${q.id}" is duplicated`);
        seen.add(q.id);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/guides/index.json`: the guide catalogue (slug + title + summary,
 * optional `class`/`tags`) that drives `/guide` autocomplete and browsing.
 * Structural checks only — the referential guard (an optional `class` names a
 * real roster class) lives in the store. A slug may be catalogued before its
 * body file is authored, so a missing body is not an error here.
 */
export function validateGuideIndex(obj, label = 'guides/index.json') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) return { ok: false, errors };
  if (obj.note !== undefined) {
    require_(errors, isNonEmptyString(obj.note), `${label}: note must be a non-empty string when present`);
  }
  if (require_(errors, Array.isArray(obj.guides) && obj.guides.length > 0, `${label}: guides must be a non-empty array`)) {
    const seen = new Set();
    obj.guides.forEach((g, i) => {
      const at = `${label}: guides[${i}]`;
      if (!require_(errors, isObject(g), `${at} must be an object`)) return;
      require_(errors, isNonEmptyString(g.slug), `${at}.slug must be a non-empty string`);
      require_(errors, isNonEmptyString(g.title), `${at}.title must be a non-empty string`);
      require_(errors, isNonEmptyString(g.summary), `${at}.summary must be a non-empty string`);
      if (g.class !== undefined) {
        require_(errors, isNonEmptyString(g.class), `${at}.class must be a non-empty string when present`);
      }
      if (g.tags !== undefined) {
        require_(errors, isStringArray(g.tags), `${at}.tags must be a non-empty string array when present`);
      }
      if (isNonEmptyString(g.slug)) {
        require_(errors, !seen.has(g.slug), `${at}.slug "${g.slug}" is duplicated`);
        seen.add(g.slug);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * `<bracket>/guides/<slug>.json`: one guide's body. Carries the same front-matter
 * as its catalogue entry (`slug`, `title`, `summary`, optional `class`/`tags`)
 * plus an ordered `sections[]` of `{ heading, body }` that the renderer paginates
 * into embed fields (Discord-flavored markdown is allowed in `body`). The
 * body/index slug match and the `class` guard live in the store.
 */
export function validateGuide(obj, label = 'guide') {
  const errors = [];
  if (!require_(errors, isObject(obj), `${label}: must be an object`)) return { ok: false, errors };
  require_(errors, isNonEmptyString(obj.slug), `${label}: slug must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.title), `${label}: title must be a non-empty string`);
  require_(errors, isNonEmptyString(obj.summary), `${label}: summary must be a non-empty string`);
  if (obj.class !== undefined) {
    require_(errors, isNonEmptyString(obj.class), `${label}: class must be a non-empty string when present`);
  }
  if (obj.tags !== undefined) {
    require_(errors, isStringArray(obj.tags), `${label}: tags must be a non-empty string array when present`);
  }
  if (require_(errors, Array.isArray(obj.sections) && obj.sections.length > 0, `${label}: sections must be a non-empty array`)) {
    obj.sections.forEach((s, i) => {
      const at = `${label}: sections[${i}]`;
      if (!require_(errors, isObject(s), `${at} must be an object`)) return;
      require_(errors, isNonEmptyString(s.heading), `${at}.heading must be a non-empty string`);
      require_(errors, isNonEmptyString(s.body), `${at}.body must be a non-empty string`);
    });
  }
  return { ok: errors.length === 0, errors };
}
