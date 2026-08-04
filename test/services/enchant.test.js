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

// Discord counts title + description + footer + every field name/value toward 6000.
function totalSize(json) {
  let n = (json.title?.length ?? 0) + (json.description?.length ?? 0) + (json.footer?.text?.length ?? 0);
  for (const f of json.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

// A class-only view (no slot filter) is the widest match set and used to 400 with
// MAX_EMBED_SIZE_EXCEEDED; build a store big enough to prove it's now capped.
const bigStore = {
  brackets: {
    19: {
      meta: { levelCap: 19, battleground: 'Warsong Gulch', gameVersion: { clientPatch: '1.15.x' } },
      enchants: {
        note: 'x'.repeat(1200),
        enchants: Array.from({ length: 30 }, (_, i) => ({
          id: `e${i}`,
          name: `Enchant Number ${i}`,
          slot: 'chest',
          effect: 'Adds a sizeable effect line to inflate the field. '.repeat(3),
          noLevelReq: true,
          notes: 'A verbose authored note that pads each field well past a trivial length. '.repeat(2),
          classes: ['warrior', 'rogue', 'hunter', 'paladin', 'shaman', 'druid', 'mage', 'warlock', 'priest']
        }))
      }
    }
  }
};

test('renderEnchant never exceeds the 6000-char embed cap under a wide class filter', () => {
  const { embeds } = renderEnchant({ store: bigStore, bracket: '19', className: 'priest' });
  const e = embeds[0].toJSON();
  assert.ok(totalSize(e) <= 6000, `embed total ${totalSize(e)} must stay <= 6000`);
  assert.equal(e.fields.at(-1).name, '\u2026', 'an overflow note is appended when entries are dropped');
});

test('renderEnchant drops the redundant Classes line only under a class filter', () => {
  const filtered = renderEnchant({ store, bracket: '19', className: 'mage' }).embeds[0].toJSON();
  assert.ok(!filtered.fields[0].value.includes('Classes:'), 'class-filtered rows omit the Classes line');

  const unfiltered = renderEnchant({ store, bracket: '19' }).embeds[0].toJSON();
  assert.ok(unfiltered.fields[0].value.includes('Classes:'), 'unfiltered rows keep the Classes line');
});
