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
