import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOptimize } from '../../src/services/optimize.js';
import { loadContentStore } from '../../src/content/store.js';

const store = {
  brackets: {
    19: {
      meta: { battleground: 'Warsong Gulch', levelCap: 19, gameVersion: { clientPatch: '1.15.x' } },
      classes: {
        index: { classes: [{ class: 'hunter', tier: 'S' }, { class: 'warrior', tier: 'A' }] },
        byClass: {
          hunter: {
            class: 'hunter',
            tier: 'S',
            factionNotes: 'Alliance hunters get green+ ammo pouches; Horde hunters lack them.'
          }
        }
      },
      enchants: {
        enchants: [{ id: 'boots-speed', name: 'Enchant Boots - Minor Speed', slot: 'boots', noLevelReq: true }]
      },
      consumables: {
        consumables: [
          { id: 'hp', name: 'Healing Potion', type: 'potion' },
          { id: 'poison', name: 'Instant Poison', type: 'poison', classes: ['rogue'] }
        ]
      },
      quests: {
        quests: [
          { id: 'nw', name: 'The Night Watch', zone: null, faction: 'alliance', reward: { desc: 'x' }, xpWarning: true, classes: ['hunter'] },
          { id: 'talbar', name: 'Talbar Quest', zone: null, faction: 'both', reward: { desc: 'y' }, xpWarning: false }
        ]
      },
      gear: {
        index: { slots: ['head', 'feet', 'trinket', 'ranged'] },
        byClass: { hunter: { class: 'hunter', items: [] } },
        byId: {},
        items: [
          { id: 'goggles', name: 'Goggles', slot: 'head', owner: 'shared', priority: 'core', faction: 'both', source: { type: 'profession', detail: 'Engineering' }, enchant: null },
          { id: 'boots', name: 'Boots', slot: 'feet', owner: 'shared', priority: 'core', faction: 'both', source: { type: 'world' }, enchant: 'boots-speed' },
          { id: 'insignia-a', name: 'Insignia A', slot: 'trinket', owner: 'shared', priority: 'core', faction: 'alliance', source: { type: 'pvp' } },
          { id: 'insignia-h', name: 'Insignia H', slot: 'trinket', owner: 'shared', priority: 'core', faction: 'horde', source: { type: 'pvp' } },
          { id: 'gun', name: 'Gun', slot: 'ranged', owner: 'hunter', priority: 'situational', faction: 'both', source: { type: 'profession' } }
        ]
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const field = (embeds, prefix) => fieldsOf(embeds).find((f) => f.name.startsWith(prefix))?.value;
const fieldName = (embeds, prefix) => fieldsOf(embeds).find((f) => f.name.startsWith(prefix))?.name;

test('renderOptimize reports core-slot coverage and the missing slots', () => {
  const { embeds } = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const e = embeds[0].toJSON();
  assert.ok(e.title.includes('Optimize Hunter'));
  assert.ok(e.title.includes('Warsong Gulch 19'));
  // head, feet, trinket covered by core alliance picks; ranged has only a situational.
  assert.equal(fieldName(embeds, 'Core slot coverage'), 'Core slot coverage \u2014 3/4');
  assert.ok(field(embeds, 'Core slot coverage').includes('ranged'));
  assert.ok(e.footer.text.includes('WoW Classic Era 1.15.x'));
});

test('renderOptimize lists core-item enchants and flags no-level-req ones', () => {
  const { embeds } = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const val = field(embeds, 'Enchants to apply');
  assert.ok(val.includes('Boots: Enchant Boots - Minor Speed'));
  assert.ok(val.includes('(no level req)'));
});

test('renderOptimize includes universal consumables but not off-class ones', () => {
  const { embeds } = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const val = field(embeds, 'Consumables to carry');
  assert.ok(val.includes('Healing Potion'));
  assert.ok(!val.includes('Instant Poison'), 'rogue-only poison excluded for hunter');
});

test('renderOptimize lists gear quests and flags XP-risk turn-ins', () => {
  const { embeds } = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const val = field(embeds, 'Gear quests worth doing');
  assert.ok(val.includes('The Night Watch \u2014 XP-risk turn-in'));
  assert.ok(/Talbar Quest(?!.*XP-risk)/.test(val));
});

test('renderOptimize reminders derive from item source types and factionNotes', () => {
  const { embeds } = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'alliance' });
  const val = field(embeds, 'Reminders');
  assert.ok(val.includes('Profession pickups: Goggles'));
  assert.ok(val.includes('PvP reward(s): Insignia A'));
  assert.ok(val.includes('ammo pouches'), 'includes the class factionNotes');
});

test('renderOptimize faction scope swaps faction-specific picks', () => {
  const horde = renderOptimize({ store, bracket: '19', className: 'hunter', faction: 'horde' });
  const reminders = field(horde.embeds, 'Reminders');
  assert.ok(reminders.includes('Insignia H'));
  assert.ok(!reminders.includes('Insignia A'));
  // Alliance-only quest drops out of the horde scope; the both-faction one stays.
  const quests = field(horde.embeds, 'Gear quests worth doing');
  assert.ok(!quests.includes('The Night Watch'));
  assert.ok(quests.includes('Talbar Quest'));
});

test('renderOptimize degrades for an unknown class and a class without a gear list', () => {
  const unknown = renderOptimize({ store, bracket: '19', className: 'mage' });
  assert.ok(unknown.embeds[0].toJSON().description.includes('No data for class'));

  const noGear = renderOptimize({ store, bracket: '19', className: 'warrior' });
  assert.ok(noGear.embeds[0].toJSON().description.includes('nothing to optimize'));
});

test('renderOptimize runs over the real content store for a seeded class', async () => {
  const real = await loadContentStore({ strict: true });
  const { embeds } = renderOptimize({ store: real, bracket: '19', className: 'hunter', faction: 'alliance' });
  const names = fieldsOf(embeds).map((f) => f.name);
  assert.ok(names.some((n) => n.startsWith('Core slot coverage')));
});
