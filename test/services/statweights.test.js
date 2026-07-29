import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStatweights } from '../../src/services/statweights.js';

const store = {
  brackets: {
    19: {
      meta: {
        battleground: 'Warsong Gulch',
        levelCap: 19,
        gameVersion: { clientPatch: '1.15.x' }
      },
      scaling: {
        note: 'Concrete conversions at 19.',
        stats: {
          agility: { label: 'Agility', summary: 'Armor, crit, dodge, AP.', conversions: ['1 Agility = 2 armor'] },
          stamina: { label: 'Stamina', summary: 'Health.', conversions: ['1 Stamina = 10 health'] },
          strength: { label: 'Strength', summary: 'Melee AP, block.', conversions: ['1 Strength = 2 AP (warrior)'] }
        },
        derived: [
          { name: 'DPS from AP', formula: 'DPS = AP / 14' },
          { name: 'Armor mitigation', formula: 'reduction% = Armor / (Armor + 2015)', notes: 'level-19 constant' }
        ],
        hitCaps: [
          { type: 'melee', value: '5%' },
          { type: 'spell', value: '3%' }
        ],
        classes: {
          hunter: { priority: ['agility', 'stamina'], notes: ['Ranged hit cap is 5%.'] },
          warrior: { priority: ['strength', 'stamina'], notes: ['Stack strength for burst.'] }
        }
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const field = (embeds, name) => fieldsOf(embeds).find((f) => f.name === name)?.value;

test('renderStatweights shows a priority line, per-stat fields, and class notes', () => {
  const { embeds } = renderStatweights({ store, bracket: '19', className: 'Hunter' });
  const e = embeds[0].toJSON();

  assert.ok(e.title.includes('Hunter'));
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('Agility > Stamina'), 'priority line uses stat labels in order');

  assert.ok(field(embeds, 'Agility').includes('1 Agility = 2 armor'));
  assert.ok(field(embeds, 'Stamina').includes('1 Stamina = 10 health'));
  assert.ok(field(embeds, 'Class notes').includes('Ranged hit cap is 5%.'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderStatweights includes derived formulas and PvP hit caps', () => {
  const { embeds } = renderStatweights({ store, bracket: '19', className: 'hunter' });
  const derived = field(embeds, 'Derived formulas');
  assert.ok(derived.includes('DPS = AP / 14'));
  assert.ok(derived.includes('(level-19 constant)'), 'notes are appended when present');

  const caps = field(embeds, 'PvP hit caps');
  assert.ok(caps.includes('Melee: 5%'));
  assert.ok(caps.includes('Spell: 3%'));
});

test('renderStatweights renders only the class priority stats, in order', () => {
  const { embeds } = renderStatweights({ store, bracket: '19', className: 'warrior' });
  const names = fieldsOf(embeds).map((f) => f.name);
  assert.ok(names.includes('Strength'));
  assert.ok(names.includes('Stamina'));
  assert.ok(!names.includes('Agility'), 'omits stats not in this class priority');
  assert.ok(names.indexOf('Strength') < names.indexOf('Stamina'), 'follows priority order');
});

test('renderStatweights degrades for a class with no authored scaling entry', () => {
  const { embeds } = renderStatweights({ store, bracket: '19', className: 'mage' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Stat Weights');
  assert.ok(e.description.includes('Mage'));
});

test('renderStatweights degrades for a bracket with no scaling data', () => {
  const { embeds } = renderStatweights({ store, bracket: '49', className: 'hunter' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Stat Weights');
  assert.ok(e.description.includes('49'));
});
