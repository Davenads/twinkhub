import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGear, renderGearPage } from '../../src/services/gear.js';
import { LIMITS } from '../../src/lib/embed.js';
import { parseCustomId } from '../../src/services/panels.js';

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

test('renderGear small result stays single-page with no nav controls', () => {
  const payload = renderGear({ store, bracket: '19', className: 'hunter' });
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.components, undefined); // no Prev/Next on a one-page result
  assert.equal(payload.embeds[0].toJSON().footer.text, 'WoW Classic Era 1.15.x'); // no page counter
});

// --- Pagination: a broad result that would overrun Discord's 6000-char cap ---

/** Combined embed length exactly as Discord counts it against the 6000 cap. */
function embedLen(embed) {
  const d = embed.toJSON();
  let n = (d.title ?? '').length + (d.description ?? '').length + (d.footer?.text ?? '').length;
  for (const f of d.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

// 16 slots, 6 verbose items each — well past 6000 chars total, like a real
// unfiltered class list once Wowhead links inflate every line.
const bigStore = (() => {
  const slots = Array.from({ length: 16 }, (_, i) => `slot${i}`);
  const items = [];
  for (const slot of slots) {
    for (let n = 0; n < 6; n++) {
      items.push({
        id: `${slot}-${n}`,
        name: `Very Long Item Name For ${slot} Number ${n} Of The Test`,
        slot,
        source: { type: 'drop', detail: 'Some fairly wordy source description to pad the line out nicely' },
        faction: 'both',
        stats: { agility: 6, stamina: 6, intellect: 4 },
        priority: 'core',
        owner: 'hunter',
        wowheadId: 10000 + items.length
      });
    }
  }
  return {
    brackets: {
      19: {
        meta: { levelCap: 19, battleground: 'Warsong Gulch', gameVersion: { clientPatch: '1.15.x' } },
        gear: { index: { slots }, byClass: { hunter: {} }, byId: {}, items }
      }
    }
  };
})();

test('renderGear paginates a broad result and every page fits under 6000', () => {
  const payload = renderGear({ store: bigStore, bracket: '19', className: 'hunter' });
  assert.ok(payload.components, 'multi-page result must carry nav controls');
  assert.ok(embedLen(payload.embeds[0]) <= LIMITS.total);
  assert.match(payload.embeds[0].toJSON().footer.text, /Page 1\/\d+$/);

  // The Next button encodes page 1 (the second page) under the gearpage action.
  const nextId = payload.components[0].toJSON().components[1].custom_id;
  const parsed = parseCustomId(nextId);
  assert.equal(parsed.action, 'gearpage');
  assert.equal(parsed.args[0], 'hunter');
  assert.equal(parsed.args.at(-1), '1');
});

// --- Shoulder slot: the level-19 vessel-meta strategy view -----------------

const shoulderItems = [
  { id: 'feral-shoulder-pads', name: 'Feral Shoulder Pads', slot: 'shoulder', armorType: 'leather', source: { type: 'drop', detail: 'Blackfathom Deeps' }, faction: 'both', priority: 'core', owner: 'shared', wowheadId: 15313 },
  { id: 'woolen-shoulders', name: 'Reinforced Woolen Shoulders', slot: 'shoulder', armorType: 'cloth', source: { type: 'profession', detail: 'Tailoring' }, faction: 'both', priority: 'core', owner: 'shared', wowheadId: 4315 },
  { id: 'talbar-mantle', name: 'Talbar Mantle', slot: 'shoulder', armorType: 'cloth', source: { type: 'quest', detail: 'Quest reward' }, faction: 'both', priority: 'core', owner: 'shared', wowheadId: 10657 }
];

const rogueBuild = {
  id: 'rogue-offense', name: 'Offense', role: 'offense', faction: 'both', default: true, owner: 'rogue',
  slots: { shoulder: { item: 'feral-shoulder-pads', enchant: 'might-scourge' } }
};

const shoulderStore = {
  brackets: {
    19: {
      meta: { levelCap: 19, battleground: 'Warsong Gulch', gameVersion: { clientPatch: '1.15.x' } },
      enchants: { enchants: [{ id: 'might-scourge', name: 'Might of the Scourge', slot: 'shoulder', wowhead: { type: 'item', id: 23548 } }] },
      gear: {
        index: {
          slots: ['head', 'shoulder'],
          armorProficiency: { cloth: ['rogue'], leather: ['rogue'], mail: [], plate: [] },
          shoulderStrategy: {
            note: 'Take the best BoE vessel and a Scourge inscription.',
            vesselByArmorType: { leather: 'feral-shoulder-pads', cloth: 'woolen-shoulders' }
          }
        },
        byClass: { rogue: {} },
        items: shoulderItems,
        byId: Object.fromEntries(shoulderItems.map((i) => [i.id, i])),
        builds: [rogueBuild],
        buildsByClass: { rogue: [rogueBuild] }
      }
    }
  }
};

test('renderGear shoulder slot renders the vessel-meta strategy view', () => {
  const { embeds } = renderGear({ store: shoulderStore, bracket: '19', className: 'rogue', slot: 'shoulder' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Gear \u2014 Rogue shoulder (Warsong Gulch 19)');
  assert.ok(e.description.includes('Scourge inscription'));

  // The vessel is the best armor type the class wears (leather over cloth here).
  const vessel = e.fields.find((f) => f.name.startsWith('Vessel'));
  assert.equal(vessel.name, 'Vessel \u2014 Leather');
  assert.ok(vessel.value.includes('Feral Shoulder Pads'));

  // The inscription is derived from the build and names the build using it.
  const insc = e.fields.find((f) => f.name === 'Scourge inscription by build');
  assert.ok(insc.value.includes('Might of the Scourge'));
  assert.ok(insc.value.includes('Offense'));

  // Off-type shoulders the class could wear are demoted, not hidden.
  const others = e.fields.find((f) => f.name === 'Other shoulders (not recommended)');
  assert.ok(others.value.includes('Talbar Mantle'));
  assert.ok(others.value.includes('Reinforced Woolen Shoulders'));
});

test('renderGearPage returns the requested page, clamped, each under 6000', () => {
  const p0 = renderGear({ store: bigStore, bracket: '19', className: 'hunter' });
  const pageCount = Number(p0.embeds[0].toJSON().footer.text.match(/Page 1\/(\d+)/)[1]);
  assert.ok(pageCount > 1);

  const p1 = renderGearPage({ store: bigStore, bracket: '19', className: 'hunter', page: 1 });
  assert.match(p1.embeds[0].toJSON().footer.text, new RegExp(`Page 2/${pageCount}$`));
  assert.ok(embedLen(p1.embeds[0]) <= LIMITS.total);
  // Prev is now enabled (not the first page).
  assert.equal(p1.components[0].toJSON().components[0].disabled, false);

  // Page far past the end clamps to the last page.
  const last = renderGearPage({ store: bigStore, bracket: '19', className: 'hunter', page: 999 });
  assert.match(last.embeds[0].toJSON().footer.text, new RegExp(`Page ${pageCount}/${pageCount}$`));
  assert.equal(last.components[0].toJSON().components[1].disabled, true); // Next disabled at end
});
