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
