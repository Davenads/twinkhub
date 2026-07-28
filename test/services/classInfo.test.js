import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClass } from '../../src/services/classInfo.js';

const store = {
  brackets: {
    19: {
      meta: {
        levelCap: 19,
        battleground: 'Warsong Gulch',
        gameVersion: { clientPatch: '1.15.x' }
      },
      classes: {
        index: {
          classes: [
            { class: 'hunter', tier: 'S', roles: ['ranged-dps'], summary: 'Top ranged DPS.' },
            { class: 'mage', tier: 'B', roles: ['ranged-dps'], summary: 'Control caster.' }
          ]
        },
        byClass: {
          hunter: {
            class: 'hunter',
            tier: 'S',
            roles: ['ranged-dps'],
            summary: 'Top ranged DPS.',
            specs: [{ name: 'BM/MM hybrid', statPriority: ['agility', 'stamina'] }],
            factionNotes: 'Both factions viable.'
          }
        }
      }
    }
  }
};

test('renderClass builds a full detail embed from the detail file', () => {
  const { embeds } = renderClass({ store, bracket: '19', className: 'Hunter' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Hunter \u2014 Tier S (Warsong Gulch 19)');
  assert.equal(e.description, 'Top ranged DPS.');

  const roles = e.fields.find((f) => f.name === 'Roles');
  assert.equal(roles.value, 'ranged-dps');

  const specs = e.fields.find((f) => f.name === 'Specs & stat priority');
  assert.ok(specs.value.includes('**BM/MM hybrid**'));
  assert.ok(specs.value.includes('Agility > Stamina'));

  const faction = e.fields.find((f) => f.name === 'Faction notes');
  assert.equal(faction.value, 'Both factions viable.');
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderClass falls back to the roster entry (no specs) for detail-less classes', () => {
  const { embeds } = renderClass({ store, bracket: '19', className: 'mage' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'Mage \u2014 Tier B (Warsong Gulch 19)');
  assert.equal(e.fields.find((f) => f.name === 'Roles').value, 'ranged-dps');
  assert.equal(e.fields.find((f) => f.name === 'Specs & stat priority'), undefined);
});

test('renderClass degrades for a class the bracket does not list', () => {
  const { embeds } = renderClass({ store, bracket: '19', className: 'shaman' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Class');
  assert.ok(e.description.includes('shaman'));
});
