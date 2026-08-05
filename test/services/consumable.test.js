import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConsumable } from '../../src/services/consumable.js';

const store = {
  emoji: {
    consumables: {
      'healing-potion': { name: 'HealingPotion', id: '111' }
    }
  },
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

test('renderConsumable prefixes a row with its consumable emoji when registered', () => {
  const { embeds } = renderConsumable({ store, bracket: '19' });
  const hp = fieldsOf(embeds).find((f) => f.name === 'Healing Potion');
  assert.ok(hp.value.startsWith('<:HealingPotion:111> '), 'icon leads the field value');
  const dyn = fieldsOf(embeds).find((f) => f.name === 'Heavy Dynamite');
  assert.ok(!dyn.value.includes('<:'), 'an unregistered consumable degrades to text-only');
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

test('renderConsumable hides the per-row class list only under a class filter', () => {
  // Venomhide Poison names class rogue; unfiltered it shows "Rogue" in the line.
  const unfiltered = renderConsumable({ store, bracket: '19' }).embeds[0].toJSON();
  const vpUn = unfiltered.fields.find((f) => f.name === 'Venomhide Poison');
  assert.ok(vpUn.value.includes('Rogue'), 'unfiltered row shows the class list');

  const filtered = renderConsumable({ store, bracket: '19', className: 'rogue' }).embeds[0].toJSON();
  const vpF = filtered.fields.find((f) => f.name === 'Venomhide Poison');
  assert.ok(!vpF.value.includes('Rogue'), 'class-filtered row omits the redundant class list');
});

// Discord counts title + description + footer + every field name/value toward 6000.
function totalSize(json) {
  let n = (json.title?.length ?? 0) + (json.description?.length ?? 0) + (json.footer?.text?.length ?? 0);
  for (const f of json.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

test('renderConsumable never exceeds the 6000-char embed cap under a wide class filter', () => {
  const bigStore = {
    brackets: {
      19: {
        meta: { battleground: 'Warsong Gulch', levelCap: 19, gameVersion: { clientPatch: '1.15.x' } },
        consumables: {
          note: 'x'.repeat(1200),
          consumables: Array.from({ length: 30 }, (_, i) => ({
            id: `c${i}`,
            name: `Consumable Number ${i}`,
            type: 'potion',
            effect: 'A sizeable effect line to inflate the field length. '.repeat(3),
            faction: 'both',
            reqLevel: 19,
            notes: 'A verbose authored note that pads each field past a trivial size. '.repeat(2)
          }))
        }
      }
    }
  };
  const { embeds } = renderConsumable({ store: bigStore, bracket: '19', className: 'priest' });
  const e = embeds[0].toJSON();
  assert.ok(totalSize(e) <= 6000, `embed total ${totalSize(e)} must stay <= 6000`);
  assert.equal(e.fields.at(-1).name, '\u2026', 'an overflow note is appended when entries are dropped');
});
