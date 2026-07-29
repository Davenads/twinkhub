import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPets } from '../../src/services/pets.js';

const store = {
  brackets: {
    19: {
      meta: {
        battleground: 'Warsong Gulch',
        levelCap: 19,
        gameVersion: { clientPatch: '1.15.x' }
      },
      pets: {
        class: 'hunter',
        families: [
          { family: 'boar', exampleName: 'Great Goretusk', keyAbility: 'Charge', tameLevel: null, zone: null, notes: 'Charge utility.' },
          { family: 'cat', exampleName: 'The Rake', keyAbility: null, attackSpeed: 1.2, tameLevel: null, zone: null, notes: 'Fastest swing.' },
          { family: 'wind-serpent', exampleName: 'Deviate Stinglash', keyAbility: null, tameLevel: null, zone: null, notes: 'Ranged nature damage.' }
        ],
        xpNote: 'Pets need ~25% of player XP and gain none from turn-ins.',
        abilityNote: 'Ability-shop while taming.',
        budgetNote: 'Sync pets first, then turn in.'
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const field = (embeds, name) => fieldsOf(embeds).find((f) => f.name === name)?.value;

test('renderPets lists every family plus the XP-management notes', () => {
  const { embeds } = renderPets({ store, bracket: '19' });
  const e = embeds[0].toJSON();

  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('25%'), 'leads with the pet-XP note');

  const names = fieldsOf(embeds).map((f) => f.name);
  assert.ok(names.some((n) => n.includes('Boar') && n.includes('Great Goretusk')));
  assert.ok(names.some((n) => n.includes('Wind Serpent')), 'hyphenated family key is title-cased');
  assert.ok(field(embeds, 'Ability shopping').includes('Ability-shop'));
  assert.ok(field(embeds, 'XP budgeting').includes('Sync pets first'));
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderPets shows the boar ability and the cat swing-speed inline meta', () => {
  const { embeds } = renderPets({ store, bracket: '19' });
  const boar = field(embeds, fieldsOf(embeds).find((f) => f.name.includes('Boar')).name);
  assert.ok(boar.includes('Ability: Charge'));
  const cat = fieldsOf(embeds).find((f) => f.name.includes('Cat')).value;
  assert.ok(cat.includes('1.2s swing'));
});

test('renderPets filters to a single family and drops the bulk notes', () => {
  const { embeds } = renderPets({ store, bracket: '19', family: 'cat' });
  const names = fieldsOf(embeds).map((f) => f.name);
  assert.ok(names.some((n) => n.includes('Cat')));
  assert.ok(!names.some((n) => n.includes('Boar')), 'other families are excluded');
  assert.equal(field(embeds, 'Ability shopping'), undefined, 'management notes hidden on a filter');
});

test('renderPets degrades for an unknown family', () => {
  const { embeds } = renderPets({ store, bracket: '19', family: 'dragon' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Hunter Pets');
  assert.ok(e.description.includes('Dragon'));
});

test('renderPets degrades for a bracket with no pet data', () => {
  const { embeds } = renderPets({ store, bracket: '49' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Hunter Pets');
  assert.ok(e.description.includes('49'));
});
