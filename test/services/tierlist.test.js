import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTierlist } from '../../src/services/tierlist.js';

const store = {
  emoji: {
    classes: {
      hunter: { name: 'classicon_hunter', id: '111' },
      rogue: { name: 'classicon_rogue', id: '222' }
      // warrior/mage intentionally absent -> text-only degrade
    }
  },
  brackets: {
    19: {
      meta: {
        levelCap: 19,
        battleground: 'Warsong Gulch',
        gameVersion: { clientPatch: '1.15.x' }
      },
      classes: {
        index: {
          tierNote: 'Tiers are composition-dependent.',
          classes: [
            { class: 'hunter', tier: 'S', roles: ['ranged-dps'], summary: 'Top ranged DPS.' },
            { class: 'rogue', tier: 'A', roles: ['melee-dps'], summary: 'Burst melee.' },
            { class: 'warrior', tier: 'A', roles: ['melee-dps'], summary: 'Flag carrier.' },
            { class: 'mage', tier: 'B', roles: ['ranged-dps'], summary: 'Control caster.' }
          ]
        },
        byClass: {}
      }
    }
  }
};

test('renderTierlist groups classes by tier, high to low', () => {
  const { embeds } = renderTierlist({ store, bracket: '19' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Class Tier List (Warsong Gulch 19)');
  assert.equal(e.description, 'Tiers are composition-dependent.');

  assert.deepEqual(
    e.fields.map((f) => f.name),
    ['Tier S', 'Tier A', 'Tier B']
  );
  assert.ok(e.fields[0].value.includes('**Hunter**'));
  assert.ok(e.fields[1].value.includes('**Rogue**'));
  assert.ok(e.fields[1].value.includes('**Warrior**'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderTierlist prefixes the class emoji when present, degrades otherwise', () => {
  const { embeds } = renderTierlist({ store, bracket: '19' });
  const e = embeds[0].toJSON();

  // Registered class -> emoji markup precedes the bold class name.
  assert.ok(e.fields[0].value.includes('<:classicon_hunter:111> **Hunter**'));
  assert.ok(e.fields[1].value.includes('<:classicon_rogue:222> **Rogue**'));
  // Unregistered class -> text-only, no stray emoji markup.
  assert.ok(e.fields[1].value.includes('**Warrior**'));
  assert.ok(!e.fields[1].value.includes('<:classicon_warrior'));
});

test('renderTierlist degrades when a bracket has no roster', () => {
  const { embeds } = renderTierlist({ store, bracket: '49' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Class Tier List');
  assert.ok(e.description.includes('49'));
  assert.equal(e.fields, undefined);
});
