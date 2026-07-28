import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBis } from '../../src/services/bis.js';

// Hand-built store mirroring the loaded gear shape (items carry `owner`).
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

test('renderBis groups a class BiS by slot in index order, core first', () => {
  const { embeds } = renderBis({ store, bracket: '19', className: 'hunter' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Best in Slot \u2014 Hunter (Warsong Gulch 19)');
  assert.deepEqual(
    e.fields.map((f) => f.name),
    ['Head', 'Trinket', 'Ranged']
  );

  // Core sorts above situational within the trinket slot.
  const trinket = e.fields.find((f) => f.name === 'Trinket').value;
  assert.ok(trinket.indexOf('Insignia') < trinket.indexOf('Minor Recombobulator'));
  assert.ok(trinket.includes('[alliance]'));
  assert.ok(trinket.includes('(situational)'));
  assert.ok(e.fields.find((f) => f.name === 'Head').value.includes('+6 Agility'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderBis narrows to a single slot', () => {
  const { embeds } = renderBis({ store, bracket: '19', className: 'hunter', slot: 'Ranged' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.equal(e.fields[0].name, 'Ranged');
  assert.ok(e.fields[0].value.includes('Boomstick'));
});

test('renderBis degrades to a message for a slot with no items', () => {
  const { embeds } = renderBis({ store, bracket: '19', className: 'hunter', slot: 'legs' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('No **legs** items'));
  assert.equal(e.fields, undefined);
});

test('renderBis degrades for a class with no authored BiS', () => {
  const { embeds } = renderBis({ store, bracket: '19', className: 'rogue' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Best in Slot');
  assert.ok(e.description.includes('Rogue'));
});

test('renderBis degrades for a bracket with no gear', () => {
  const { embeds } = renderBis({ store, bracket: '49', className: 'hunter' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('No gear data'));
});
