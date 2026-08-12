import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  hasAdminAccess,
  requireAdmin,
  hasManagerAccess,
  hasRequesterAccess,
  requireManager,
  requireRequester
} from '../../src/lib/access.js';

/**
 * Minimal GuildMember stand-in. `perms` is an array of PermissionFlagsBits the
 * member holds; `roles` is a list of { id, name } (matches how the real member's
 * `roles.cache` is iterated with `.some`).
 */
function member({ perms = [], roles = [] } = {}) {
  return {
    permissions: { has: (flag) => perms.includes(flag) },
    roles: { cache: roles }
  };
}

/** Run a body with DISCORD_ADMIN_ROLE_IDS set, restoring the prior value after. */
function withAdminRoleIds(value, fn) {
  const prev = process.env.DISCORD_ADMIN_ROLE_IDS;
  if (value == null) delete process.env.DISCORD_ADMIN_ROLE_IDS;
  else process.env.DISCORD_ADMIN_ROLE_IDS = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.DISCORD_ADMIN_ROLE_IDS;
    else process.env.DISCORD_ADMIN_ROLE_IDS = prev;
  }
}

test('hasAdminAccess: Manage Server permission always qualifies (no roles needed)', () => {
  withAdminRoleIds(null, () => {
    const m = member({ perms: [PermissionFlagsBits.ManageGuild] });
    assert.equal(hasAdminAccess(m), true);
  });
});

test('hasAdminAccess: a configured admin role ID grants access', () => {
  withAdminRoleIds('111,222', () => {
    const m = member({ roles: [{ id: '222', name: 'staff' }] });
    assert.equal(hasAdminAccess(m), true);
  });
});

test('hasAdminAccess: no perm + no matching role ID is denied when IDs are configured', () => {
  withAdminRoleIds('111,222', () => {
    const m = member({ roles: [{ id: '999', name: 'member' }] });
    assert.equal(hasAdminAccess(m), false);
  });
});

test('hasAdminAccess: a role *named* "dev" no longer escalates once role IDs are set', () => {
  withAdminRoleIds('111', () => {
    // The legacy name path is disabled the moment real IDs are configured.
    const m = member({ roles: [{ id: '999', name: 'Dev' }] });
    assert.equal(hasAdminAccess(m), false);
  });
});

test('hasAdminAccess: legacy "dev" role-name fallback applies only when no IDs configured', () => {
  withAdminRoleIds(null, () => {
    assert.equal(hasAdminAccess(member({ roles: [{ id: '5', name: 'DEV' }] })), true);
    assert.equal(hasAdminAccess(member({ roles: [{ id: '5', name: 'member' }] })), false);
  });
});

test('hasAdminAccess: null/undefined member is denied', () => {
  assert.equal(hasAdminAccess(null), false);
  assert.equal(hasAdminAccess(undefined), false);
});

test('requireAdmin: returns true and does not reply when access is granted', async () => {
  await withAdminRoleIds(null, async () => {
    let replied = false;
    const interaction = {
      member: member({ perms: [PermissionFlagsBits.ManageGuild] }),
      reply: async () => {
        replied = true;
      }
    };
    assert.equal(await requireAdmin(interaction), true);
    assert.equal(replied, false, 'no denial reply on success');
  });
});

test('requireAdmin: replies ephemerally and returns false when denied', async () => {
  await withAdminRoleIds('111', async () => {
    let payload = null;
    const interaction = {
      member: member({ roles: [{ id: '999', name: 'member' }] }),
      reply: async (p) => {
        payload = p;
      }
    };
    assert.equal(await requireAdmin(interaction), false);
    assert.ok(payload, 'should reply on denial');
    // Ephemeral flag (1 << 6 = 64) must be set so the denial is private.
    assert.equal(Boolean(payload.flags & 64), true, 'denial reply is ephemeral');
  });
});

// --- Stash Manager / Requester gates -------------------------------------------
// These read per-guild *config* (not env), so the pure predicates take a `cfg`
// object and the require* wrappers accept an injected `loadConfig` — no secrets,
// no real files, no DB.

const cfgWith = (stash) => ({ stash: stash ?? null });

test('hasManagerAccess: Manage Server qualifies regardless of config', () => {
  const m = member({ perms: [PermissionFlagsBits.ManageGuild] });
  assert.equal(hasManagerAccess(m, cfgWith(null)), true);
});

test('hasManagerAccess: a configured manager role ID grants access', () => {
  const m = member({ roles: [{ id: 'mgr1', name: 'Stash Manager' }] });
  assert.equal(hasManagerAccess(m, cfgWith({ managerRoleIds: ['mgr1', 'mgr2'] })), true);
});

test('hasManagerAccess: no perm + no matching role is denied', () => {
  const m = member({ roles: [{ id: 'other', name: 'member' }] });
  assert.equal(hasManagerAccess(m, cfgWith({ managerRoleIds: ['mgr1'] })), false);
});

test('hasManagerAccess: null stash config => only Manage Server passes', () => {
  assert.equal(hasManagerAccess(member({ roles: [{ id: 'x' }] }), cfgWith(null)), false);
  assert.equal(
    hasManagerAccess(member({ perms: [PermissionFlagsBits.ManageGuild] }), cfgWith(null)),
    true
  );
});

test('hasManagerAccess: null member is denied', () => {
  assert.equal(hasManagerAccess(null, cfgWith({ managerRoleIds: ['mgr1'] })), false);
});

test('hasRequesterAccess: a configured requester (Twink) role grants access', () => {
  const m = member({ roles: [{ id: 'twink', name: 'Twink' }] });
  assert.equal(hasRequesterAccess(m, cfgWith({ requesterRoleIds: ['twink'] })), true);
});

test('hasRequesterAccess: managers pass even without a requester role', () => {
  const m = member({ perms: [PermissionFlagsBits.ManageGuild] });
  assert.equal(hasRequesterAccess(m, cfgWith({ requesterRoleIds: ['twink'] })), true);
  const byRole = member({ roles: [{ id: 'mgr1' }] });
  assert.equal(
    hasRequesterAccess(byRole, cfgWith({ managerRoleIds: ['mgr1'], requesterRoleIds: ['twink'] })),
    true
  );
});

test('hasRequesterAccess: non-twink non-manager is denied', () => {
  const m = member({ roles: [{ id: 'other' }] });
  assert.equal(hasRequesterAccess(m, cfgWith({ requesterRoleIds: ['twink'] })), false);
});

test('requireManager: returns true and does not reply when granted', async () => {
  let replied = false;
  const interaction = {
    guildId: 'g1',
    member: member({ perms: [PermissionFlagsBits.ManageGuild] }),
    reply: async () => {
      replied = true;
    }
  };
  const loadConfig = async () => cfgWith(null);
  assert.equal(await requireManager(interaction, { loadConfig }), true);
  assert.equal(replied, false, 'no denial reply on success');
});

test('requireManager: replies ephemerally and returns false when denied', async () => {
  let payload = null;
  const interaction = {
    guildId: 'g1',
    member: member({ roles: [{ id: 'other' }] }),
    reply: async (p) => {
      payload = p;
    }
  };
  const loadConfig = async () => cfgWith({ managerRoleIds: ['mgr1'] });
  assert.equal(await requireManager(interaction, { loadConfig }), false);
  assert.ok(payload, 'should reply on denial');
  assert.equal(Boolean(payload.flags & 64), true, 'denial reply is ephemeral');
});

test('requireRequester: passes a configured twink role, denies others ephemerally', async () => {
  const loadConfig = async () => cfgWith({ requesterRoleIds: ['twink'] });

  const ok = {
    guildId: 'g1',
    member: member({ roles: [{ id: 'twink' }] }),
    reply: async () => assert.fail('should not reply on success')
  };
  assert.equal(await requireRequester(ok, { loadConfig }), true);

  let payload = null;
  const denied = {
    guildId: 'g1',
    member: member({ roles: [{ id: 'other' }] }),
    reply: async (p) => {
      payload = p;
    }
  };
  assert.equal(await requireRequester(denied, { loadConfig }), false);
  assert.equal(Boolean(payload.flags & 64), true, 'denial reply is ephemeral');
});
