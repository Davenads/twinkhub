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
  // The overview groups by slot: one field per slot (here weapon + boots), in the
  // deliberate SLOT_ORDER, with the "Enchant <Slot> - " name prefix stripped.
  assert.deepEqual(e.fields.map((f) => f.name), ['Weapon', 'Boots']);
  assert.ok(e.fields[0].value.includes('Fiery Weapon'), 'enchant name (masked link) leads the line');
  assert.ok(!e.fields[0].value.includes('Enchant Weapon -'), 'redundant slot prefix stripped');
  assert.ok(!e.fields[0].value.includes('Ignores the item'), 'no per-row level-req line');
  assert.ok(e.footer.text.includes('Values confirmed on Wowhead Classic'), 'footer states provenance once');
});

test('renderEnchant flags a level requirement inline in the grouped overview', () => {
  const s = structuredClone(store);
  s.brackets['19'].enchants.enchants[0].noLevelReq = false;
  s.brackets['19'].enchants.enchants[0].reqLevel = 35;
  const e = renderEnchant({ store: s, bracket: '19' }).embeds[0].toJSON();
  const weapon = e.fields.find((f) => f.name === 'Weapon');
  const boots = e.fields.find((f) => f.name === 'Boots');
  assert.ok(weapon.value.includes('requires level 35'), 'gated enchant tagged inline');
  assert.ok(!boots.value.includes('requires level'), 'no-level-req rows stay bare');
});

test('renderEnchant tags the field name when a slot-filtered enchant gates on level', () => {
  const s = structuredClone(store);
  s.brackets['19'].enchants.enchants[0].noLevelReq = false;
  s.brackets['19'].enchants.enchants[0].reqLevel = 35;
  const e = renderEnchant({ store: s, bracket: '19', slot: 'weapon' }).embeds[0].toJSON();
  assert.equal(e.fields[0].name, 'Fiery Weapon \u2014 requires level 35');
});

test('renderEnchant filters by slot and headers each field with the enchant name', () => {
  const { embeds } = renderEnchant({ store, bracket: '19', slot: 'Boots' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  // Header is the enchant name (slot prefix stripped), NOT a repeated "Boots".
  assert.equal(e.fields[0].name, 'Minor Speed');
  assert.ok(e.fields[0].value.includes('movement speed'), 'effect leads the value');
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

test('renderEnchant omits the Classes line in every view (slot detail carries effect + notes only)', () => {
  // The Classes line is dropped everywhere: within a slot it's near-identical row
  // to row (use `/enchant class:<x>` to narrow), and the grouped overview never
  // carried it.
  const withClass = renderEnchant({ store, bracket: '19', slot: 'weapon', className: 'warrior' }).embeds[0].toJSON();
  assert.ok(!withClass.fields[0].value.includes('Classes:'), 'class-filtered rows omit the Classes line');

  const noClass = renderEnchant({ store, bracket: '19', slot: 'weapon' }).embeds[0].toJSON();
  assert.ok(!noClass.fields[0].value.includes('Classes:'), 'slot detail omits the Classes line too');

  const overview = renderEnchant({ store, bracket: '19' }).embeds[0].toJSON();
  assert.ok(!overview.fields[0].value.includes('Classes:'), 'grouped overview omits the Classes line');
});

test('renderEnchant separates slot-detail fields with a trailing blank line except the last', () => {
  // Discord stacks consecutive fields with no gap, so each block but the last ends
  // with a zero-width blank line (\n\u200b) to keep the bold headers distinct.
  const s = {
    brackets: {
      19: {
        meta: store.brackets['19'].meta,
        enchants: {
          note: 'n',
          enchants: [
            { id: 'a', name: 'Enchant Weapon - Alpha', slot: 'weapon', effect: 'Effect A.', noLevelReq: true, classes: ['warrior'] },
            { id: 'b', name: 'Enchant Weapon - Beta', slot: 'weapon', effect: 'Effect B.', noLevelReq: true, classes: ['warrior'] }
          ]
        }
      }
    }
  };
  const e = renderEnchant({ store: s, bracket: '19', slot: 'weapon' }).embeds[0].toJSON();
  assert.equal(e.fields.length, 2);
  assert.ok(e.fields[0].value.endsWith('\u200b'), 'non-last field ends with a zero-width blank line');
  assert.ok(!e.fields[1].value.endsWith('\u200b'), 'the last field has no trailing spacer');
});
