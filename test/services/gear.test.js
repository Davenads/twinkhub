import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGear } from '../../src/services/gear.js';

const store = {
  brackets: {
    19: {
      meta: {
        levelCap: 19,
        battleground: 'Warsong Gulch',
        gameVersion: { clientPatch: '1.15.x' }
      },
      gear: {
        index: { slots: ['head', 'trinket', 'ranged'], notes: 'Seed picks.' },
        byClass: { hunter: {} },
        byId: {},
        items: [
          {
            id: 'green-tinted-goggles',
            name: 'Green Tinted Goggles',
            slot: 'head',
            source: { type: 'profession', detail: 'Engineering' },
            faction: 'both',
            stats: { agility: 6, stamina: 6 },
            priority: 'core',
            owner: 'shared'
          },
          {
            id: 'insignia-of-the-alliance',
            name: 'Insignia of the Alliance',
            slot: 'trinket',
            source: { type: 'pvp', detail: 'Honor' },
            faction: 'alliance',
            priority: 'core',
            owner: 'shared'
          },
          {
            id: 'insignia-of-the-horde',
            name: 'Insignia of the Horde',
            slot: 'trinket',
            source: { type: 'pvp', detail: 'Honor' },
            faction: 'horde',
            priority: 'core',
            owner: 'shared'
          },
          {
            id: 'minor-recombobulator',
            name: 'Minor Recombobulator',
            slot: 'trinket',
            source: { type: 'profession', detail: 'Engineering' },
            faction: 'both',
            priority: 'situational',
            owner: 'shared'
          },
          {
            id: 'precisely-calibrated-boomstick',
            name: 'Precisely Calibrated Boomstick',
            slot: 'ranged',
            source: { type: 'profession', detail: 'Engineering' },
            faction: 'both',
            priority: 'core',
            owner: 'hunter'
          }
        ]
      }
    }
  }
};

test('renderGear with no filters lists everything grouped by slot', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Gear \u2014 Hunter (Warsong Gulch 19)');
  assert.deepEqual(
    e.fields.map((f) => f.name),
    ['Head', 'Trinket', 'Ranged']
  );
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderGear narrows to a single slot and summarizes the scope', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter', slot: 'Trinket' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.equal(e.fields[0].name, 'Trinket');
  assert.ok(e.description.includes('slot **trinket**'));
});

test('renderGear faction alliance keeps alliance and both, drops horde', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const trinket = embeds[0].toJSON().fields.find((f) => f.name === 'Trinket').value;
  assert.ok(trinket.includes('Insignia of the Alliance'));
  assert.ok(trinket.includes('Minor Recombobulator'));
  assert.ok(!trinket.includes('Insignia of the Horde'));
});

test('renderGear faction both narrows to faction-agnostic items only', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter', faction: 'both' });
  const trinket = embeds[0].toJSON().fields.find((f) => f.name === 'Trinket').value;
  assert.ok(trinket.includes('Minor Recombobulator'));
  assert.ok(!trinket.includes('Insignia'));
});

test('renderGear priority situational keeps only situational items', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter', priority: 'situational' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.equal(e.fields[0].name, 'Trinket');
  assert.ok(e.fields[0].value.includes('Minor Recombobulator'));
});

test('renderGear combines filters and lists both in the scope summary', () => {
  const { embeds } = renderGear({
    store,
    bracket: '19',
    className: 'hunter',
    slot: 'trinket',
    faction: 'horde'
  });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('slot **trinket**'));
  assert.ok(e.description.includes('faction **horde**'));
  assert.ok(e.description.includes(' and '));
  assert.ok(e.fields[0].value.includes('Insignia of the Horde'));
});

test('renderGear degrades when a filter matches nothing', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'hunter', priority: 'budget' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('No gear matches'));
  assert.ok(e.description.includes('priority **budget**'));
  assert.equal(e.fields, undefined);
});

test('renderGear degrades for a class with no authored gear', () => {
  const { embeds } = renderGear({ store, bracket: '19', className: 'rogue' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Gear');
  assert.ok(e.description.includes('Rogue'));
});

test('renderGear degrades for a bracket with no gear', () => {
  const { embeds } = renderGear({ store, bracket: '49', className: 'hunter' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('No gear data'));
});
