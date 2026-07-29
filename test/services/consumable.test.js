import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConsumable } from '../../src/services/consumable.js';

const store = {
  brackets: {
    19: {
      meta: {
        battleground: 'Warsong Gulch',
        levelCap: 19,
        gameVersion: { clientPatch: '1.15.x' }
      },
      consumables: {
        note: 'Seeded from verified domain notes.',
        consumables: [
          { id: 'healing-potion', name: 'Healing Potion', type: 'potion', effect: 'Instant heal on cooldown.', faction: 'both', reqLevel: null },
          { id: 'venomhide-poison', name: 'Venomhide Poison', type: 'poison', effect: 'Stacking DPS poison.', classes: ['rogue'] },
          { id: 'heavy-dynamite', name: 'Heavy Dynamite', type: 'explosive', effect: 'Thrown AoE fire.', source: { type: 'profession', detail: 'Engineering (crafted)' } }
        ]
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const fieldNames = (embeds) => fieldsOf(embeds).map((f) => f.name);

test('renderConsumable lists all consumables with the file note and title', () => {
  const { embeds } = renderConsumable({ store, bracket: '19' });
  const e = embeds[0].toJSON();
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('Seeded from verified domain notes'));
  const names = fieldNames(embeds);
  assert.ok(names.includes('Healing Potion'));
  assert.ok(names.includes('Venomhide Poison'));
  assert.ok(names.includes('Heavy Dynamite'));
  assert.ok(e.footer.text.includes('WoW Classic Era 1.15.x'));
});

test('renderConsumable filters by type', () => {
  const { embeds } = renderConsumable({ store, bracket: '19', type: 'potion' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('Filtered to'));
  assert.deepEqual(fieldNames(embeds), ['Healing Potion']);
});

test('renderConsumable class filter keeps universal + class-specific consumables', () => {
  const rogue = renderConsumable({ store, bracket: '19', className: 'rogue' });
  const rNames = fieldNames(rogue.embeds);
  assert.ok(rNames.includes('Venomhide Poison'), 'rogue sees its poison');
  assert.ok(rNames.includes('Healing Potion'), 'rogue also sees universal consumables');

  const priest = renderConsumable({ store, bracket: '19', className: 'priest' });
  assert.ok(!fieldNames(priest.embeds).includes('Venomhide Poison'), 'priest does not see the rogue poison');
});

test('renderConsumable degrades on no match and on an unloaded bracket', () => {
  const noMatch = renderConsumable({ store, bracket: '19', type: 'worldbuff' });
  assert.ok(noMatch.embeds[0].toJSON().description.includes('No consumables match'));

  const noData = renderConsumable({ store, bracket: '49' });
  assert.ok(noData.embeds[0].toJSON().description.includes('No consumable data is loaded'));
});
