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

// --- Multi-build view -------------------------------------------------------

const buildItems = [
  { id: 'lucky-fishing-hat', name: 'Lucky Fishing Hat', slot: 'head', faction: 'both', priority: 'core', owner: 'shared' },
  { id: 'speedy-boots', name: 'Speedy Boots', slot: 'feet', faction: 'both', priority: 'core', owner: 'rogue' },
  { id: 'seal-of-sylvanas', name: 'Seal of Sylvanas', slot: 'finger', faction: 'horde', priority: 'core', owner: 'shared' },
  { id: 'blood-ring', name: 'Blood Ring', slot: 'finger', faction: 'both', priority: 'core', owner: 'shared' },
  { id: 'assassins-blade', name: "Assassin's Blade", slot: 'mainhand', faction: 'both', priority: 'core', owner: 'rogue' }
];
const rogueBuilds = [
  {
    id: 'rogue-offense',
    name: 'Offense',
    role: 'offense',
    faction: 'horde',
    default: true,
    owner: 'rogue',
    slots: {
      head: { item: 'lucky-fishing-hat', enchant: null },
      feet: { item: 'speedy-boots', enchant: 'minor-speed-boots' },
      mainhand: { item: 'assassins-blade', enchant: 'fiery-weapon' },
      finger: [
        { item: 'seal-of-sylvanas', enchant: null },
        { item: 'blood-ring', enchant: null }
      ]
    }
  },
  {
    id: 'rogue-midfield',
    name: 'Midfield',
    role: 'midfield',
    faction: 'horde',
    default: false,
    owner: 'rogue',
    slots: {
      head: { item: 'lucky-fishing-hat', enchant: null },
      feet: { item: 'speedy-boots', enchant: 'minor-speed-boots' }
    }
  },
  {
    id: 'rogue-offense-alliance',
    name: 'Offense',
    role: 'offense',
    faction: 'alliance',
    default: false,
    owner: 'rogue',
    slots: {
      head: { item: 'lucky-fishing-hat', enchant: null },
      feet: { item: 'speedy-boots', enchant: 'minor-speed-boots' },
      mainhand: { item: 'assassins-blade', enchant: 'fiery-weapon' },
      finger: [
        { item: 'blood-ring', enchant: null },
        { item: 'blood-ring', enchant: null }
      ]
    }
  }
];
// A single-faction class (Alliance-only, like Paladin) for the fallback path.
const paladinBuilds = [
  {
    id: 'paladin-offense',
    name: 'Offense',
    role: 'offense',
    faction: 'alliance',
    default: true,
    owner: 'paladin',
    slots: { head: { item: 'lucky-fishing-hat', enchant: null } }
  }
];
const allBuilds = [...rogueBuilds, ...paladinBuilds];
const buildStore = {
  brackets: {
    19: {
      meta: { levelCap: 19, battleground: 'Warsong Gulch', gameVersion: { clientPatch: '1.15.x' } },
      enchants: {
        enchants: [
          { id: 'fiery-weapon', name: 'Fiery Weapon' },
          { id: 'minor-speed-boots', name: 'Minor Speed' }
        ]
      },
      gear: {
        index: { slots: ['head', 'feet', 'mainhand', 'finger'], notes: 'Seed picks.' },
        byClass: { rogue: {}, paladin: {} },
        byId: Object.fromEntries(buildItems.map((i) => [i.id, i])),
        items: buildItems,
        builds: allBuilds,
        buildsByClass: { rogue: rogueBuilds, paladin: paladinBuilds }
      }
    }
  }
};

test('renderBis renders the default build when no build is named', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Best in Slot \u2014 Rogue \u00b7 Offense (Warsong Gulch 19)');
  assert.deepEqual(
    e.fields.map((f) => f.name),
    ['Head', 'Feet', 'Mainhand', 'Finger']
  );
  // Per-(build, slot) enchant is spelled out.
  assert.ok(e.fields.find((f) => f.name === 'Feet').value.includes('_Minor Speed_'));
  assert.ok(e.fields.find((f) => f.name === 'Mainhand').value.includes('_Fiery Weapon_'));
  // Dual finger picks render as two lines, faction tag shows.
  const finger = e.fields.find((f) => f.name === 'Finger').value;
  assert.equal(finger.split('\n').length, 2);
  assert.ok(finger.includes('[horde]'));
  // Description points at the other build.
  assert.ok(e.description.includes('Other builds: Midfield'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderBis renders a named build (by id) and drops slots it omits', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue', build: 'rogue-midfield' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Best in Slot \u2014 Rogue \u00b7 Midfield (Warsong Gulch 19)');
  assert.deepEqual(
    e.fields.map((f) => f.name),
    ['Head', 'Feet']
  );
});

test('renderBis narrows a build to a single slot', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue', slot: 'Mainhand' });
  const e = embeds[0].toJSON();
  assert.equal(e.fields.length, 1);
  assert.equal(e.fields[0].name, 'Mainhand');
  assert.ok(e.fields[0].value.includes("Assassin's Blade"));
});

test('renderBis degrades for an unknown build id', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue', build: 'rogue-tank' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Best in Slot');
  assert.ok(e.description.includes('No build **rogue-tank**'));
});

test('renderBis defaults to the Horde build when no faction is given', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('(horde)'), 'no-faction default is Horde');
});

test('renderBis selects the Alliance build when faction:alliance', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue', faction: 'alliance' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Best in Slot \u2014 Rogue \u00b7 Offense (Warsong Gulch 19)');
  assert.ok(e.description.includes('(alliance)'), 'chosen build is the Alliance one');
  // Alliance build uses Blood Ring (both), never the Horde-only Seal of Sylvanas.
  const finger = e.fields.find((f) => f.name === 'Finger').value;
  assert.ok(!finger.includes('Seal of Sylvanas'));
});

test('renderBis honors an explicit Alliance build id even without the faction arg', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'rogue', build: 'rogue-offense-alliance' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('(alliance)'));
});

test('renderBis falls back with a note when a single-faction class is asked for the other side', () => {
  const { embeds } = renderBis({ store: buildStore, bracket: '19', className: 'paladin', faction: 'horde' });
  const e = embeds[0].toJSON();
  assert.ok(e.description.includes('no Horde builds'), 'explains the fallback');
  assert.ok(e.description.includes('showing Alliance'));
});
