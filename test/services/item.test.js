import test from 'node:test';
import assert from 'node:assert/strict';
import { renderItem } from '../../src/services/item.js';

const store = {
  brackets: {
    19: {
      meta: { gameVersion: { clientPatch: '1.15.x' } },
      enchants: {
        enchants: [
          {
            id: 'minor-speed-boots',
            name: 'Enchant Boots - Minor Speed',
            slot: 'boots',
            effect: '+8% movement speed.',
            noLevelReq: true
          }
        ]
      },
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
            owner: 'shared',
            alternatives: ['lucky-fishing-hat']
          },
          'lucky-fishing-hat': {
            id: 'lucky-fishing-hat',
            name: 'Lucky Fishing Hat',
            slot: 'head',
            source: { type: 'world', detail: 'Fishing' },
            faction: 'both',
            reqLevel: null,
            priority: 'situational',
            owner: 'shared'
          },
          'feet-of-the-lynx': {
            id: 'feet-of-the-lynx',
            name: 'Feet of the Lynx',
            slot: 'feet',
            source: { type: 'world', detail: 'World drop (BoE)' },
            faction: 'both',
            reqLevel: null,
            priority: 'core',
            owner: 'shared',
            enchant: 'minor-speed-boots',
            alternatives: ['trailblazer-boots']
          },
          'trailblazer-boots': {
            id: 'trailblazer-boots',
            name: 'Trailblazer Boots',
            slot: 'feet',
            source: { type: 'quest', detail: 'Quest reward' },
            faction: 'both',
            reqLevel: null,
            priority: 'situational',
            owner: 'shared'
          },
          orphan: {
            id: 'orphan',
            name: 'Orphaned Pick',
            slot: 'feet',
            source: { type: 'drop', detail: 'x' },
            faction: 'both',
            reqLevel: null,
            priority: 'budget',
            owner: 'shared',
            enchant: 'ghost-enchant',
            alternatives: ['ghost-item']
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

const fieldsOf = (embeds) => embeds[0].toJSON().fields;
const field = (embeds, name) => fieldsOf(embeds).find((f) => f.name === name)?.value;

test('renderItem shows full detail and a Wowhead link when wowheadId is set', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'green-tinted-goggles' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Green Tinted Goggles');
  assert.equal(e.description, 'BiS head for many specs.');

  assert.equal(field(embeds, 'Slot'), 'Head');
  assert.equal(field(embeds, 'Faction'), 'Both');
  assert.equal(field(embeds, 'Stats'), '+6 Agility, +6 Stamina');
  assert.ok(field(embeds, 'Source').includes('Engineering'));
  assert.equal(field(embeds, 'Required level'), '18');
  // The Wowhead link is now the clickable embed title (setURL), not a raw-URL field.
  assert.equal(field(embeds, 'Wowhead'), undefined);
  assert.ok(e.url.includes('item=10504'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderItem omits Wowhead/level and shows the owning class for a class item', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'bandolier-of-the-night-watch' });

  assert.equal(field(embeds, 'Class'), 'Hunter');
  assert.equal(field(embeds, 'Wowhead'), undefined);
  assert.equal(field(embeds, 'Required level'), undefined);
  assert.equal(field(embeds, 'Stats'), undefined);
  assert.equal(field(embeds, 'Recommended enchant'), undefined);
  assert.equal(field(embeds, 'Alternatives'), undefined);
});

test('renderItem lists resolved alternatives with their slot', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'green-tinted-goggles' });
  const alts = field(embeds, 'Alternatives');
  assert.ok(alts.includes('Lucky Fishing Hat'));
  assert.ok(alts.includes('(Head)'));
});

test('renderItem resolves a recommended enchant to its name, effect, and no-level note', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'feet-of-the-lynx' });
  const ench = field(embeds, 'Recommended enchant');
  assert.ok(ench.includes('Enchant Boots - Minor Speed'));
  assert.ok(ench.includes('+8% movement speed.'));
  assert.ok(ench.includes('No level requirement.'));
  assert.ok(field(embeds, 'Alternatives').includes('Trailblazer Boots'));
});

test('renderItem falls back to raw ids when an enchant/alternative cannot resolve', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'orphan' });
  assert.equal(field(embeds, 'Recommended enchant'), 'ghost-enchant');
  assert.equal(field(embeds, 'Alternatives'), 'ghost-item');
});

test('renderItem degrades to a clear message for an unknown id', () => {
  const { embeds } = renderItem({ store, bracket: '19', id: 'nope' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Item');
  assert.ok(e.description.includes('nope'));
});
