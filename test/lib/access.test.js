import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { hasAdminAccess, requireAdmin } from '../../src/lib/access.js';

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
