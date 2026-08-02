import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEnchant } from '../../src/services/enchant.js';

const store = {
  brackets: {
    19: {
      meta: {
        levelCap: 19,
        battleground: 'Warsong Gulch',
        gameVersion: { clientPatch: '1.15.x' }
      },
      enchants: {
        note: 'No-level-req enchants are the cornerstone.',
        enchants: [
          {
            id: 'fiery-weapon',
            name: 'Enchant Weapon - Fiery Weapon',
            slot: 'weapon',
            effect: 'Chance on hit: +40 Fire damage.',
            noLevelReq: true,
            notes: 'Iconic melee twink enchant.',
            classes: ['warrior', 'rogue']
          },
          {
            id: 'minor-speed-boots',
            name: 'Enchant Boots - Minor Speed',
            slot: 'boots',
            effect: '+8% movement speed.',
            noLevelReq: true,
            classes: ['warrior', 'rogue', 'mage']
          }
        ]
      }
    }
  }
};

test('renderEnchant lists all enchants and flags no-level-req ones', () => {
  const { embeds } = renderEnchant({ store, bracket: '19' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Enchants (Warsong Gulch 19)');
  assert.ok(e.description.includes('cornerstone'));
  assert.equal(e.fields.length, 2);
  assert.ok(e.fields[0].name.includes('no level req'));
  // Enchant name now leads the value line (so its Wowhead masked link renders).
  assert.ok(e.fields[0].value.includes('Enchant Weapon - Fiery Weapon'));
  assert.ok(e.fields[0].value.includes('Ignores the item'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderEnchant filters by slot', () => {
  const { embeds } = renderEnchant({ store, bracket: '19', slot: 'Boots' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.ok(e.fields[0].name.includes('Boots'));
  assert.ok(e.fields[0].value.includes('Minor Speed'));
  assert.ok(e.description.includes('slot **boots**'));
});

test('renderEnchant filters by class', () => {
  const { embeds } = renderEnchant({ store, bracket: '19', className: 'mage' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.ok(e.fields[0].value.includes('Minor Speed'));
});

test('renderEnchant degrades when no enchant matches the filters', () => {
  const { embeds } = renderEnchant({ store, bracket: '19', slot: 'weapon', className: 'mage' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('No enchants match'));
  assert.equal(e.fields, undefined);
});

test('renderEnchant degrades for a bracket with no enchant data', () => {
  const { embeds } = renderEnchant({ store, bracket: '49' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Enchants');
  assert.ok(e.description.includes('49'));
});
