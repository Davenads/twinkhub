import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItem } from '../../src/services/item.js';

const store = {
  brackets: {
    19: {
      meta: { gameVersion: { clientPatch: '1.15.x' } },
      gear: {
        byId: {
          'green-tinted-goggles': {
            id: 'green-tinted-goggles',
            name: 'Green Tinted Goggles',
            slot: 'head',
            source: { type: 'profession', detail: 'Engineering (crafted)' },
            faction: 'both',
            stats: { agility: 6, stamina: 6 },
            reqLevel: 18,
            wowheadId: 10504,
            notes: 'BiS head for many specs.',
            priority: 'core',
            owner: 'shared'
          },
          'bandolier-of-the-night-watch': {
            id: 'bandolier-of-the-night-watch',
            name: 'Bandolier of the Night Watch',
            slot: 'ammo',
            source: { type: 'quest', detail: 'The Night Watch' },
            faction: 'alliance',
            reqLevel: null,
            wowheadId: null,
            priority: 'core',
            owner: 'hunter'
          }
        }
      }
    }
  }
};

test('renderItem shows full detail and a Wowhead link when wowheadId is set', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'green-tinted-goggles' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Green Tinted Goggles');
  assert.equal(e.description, 'BiS head for many specs.');

  const field = (name) => e.fields.find((f) => f.name === name)?.value;
  assert.equal(field('Slot'), 'Head');
  assert.equal(field('Faction'), 'Both');
  assert.equal(field('Stats'), '+6 Agility, +6 Stamina');
  assert.ok(field('Source').includes('Engineering'));
  assert.equal(field('Required level'), '18');
  assert.ok(field('Wowhead').includes('item=10504'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderItem omits Wowhead/level and shows the owning class for a class item', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'bandolier-of-the-night-watch' });
  const e = embeds[0].toJSON();

  assert.equal(e.fields.find((f) => f.name === 'Class').value, 'Hunter');
  assert.equal(e.fields.find((f) => f.name === 'Wowhead'), undefined);
  assert.equal(e.fields.find((f) => f.name === 'Required level'), undefined);
  assert.equal(e.fields.find((f) => f.name === 'Stats'), undefined);
});

test('renderItem degrades to a clear message for an unknown id', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'nope' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Item');
  assert.ok(e.description.includes('nope'));
});
