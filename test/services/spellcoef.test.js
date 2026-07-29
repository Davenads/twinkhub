import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSpellcoef } from '../../src/services/spellcoef.js';

const store = {
  brackets: {
    19: {
      meta: {
        battleground: 'Warsong Gulch',
        levelCap: 19,
        gameVersion: { clientPatch: '1.15.x' }
      },
      classes: {
        index: {
          classes: [
            { class: 'mage' },
            { class: 'priest' },
            { class: 'warrior' }
          ]
        },
        byClass: {}
      },
      spellcoef: {
        penalty: { perLevelBelow20: 0.0375, note: 'Sub-20 penalty applies; values are level-19-effective.' },
        byClass: {
          mage: [
            { spell: 'Frostbolt', rank: 3, coefficient: 0.463, type: 'direct-damage', confirmed: false },
            { spell: 'Fireball', rank: 4, coefficient: 0.793, type: 'direct-damage', confirmed: false },
            { spell: 'Fireball', rank: 4, coefficient: 0, type: 'dot', confirmed: false, notes: 'DoT does not scale.' }
          ],
          priest: [
            { spell: 'Lesser Heal', rank: 3, coefficient: 0.446, type: 'direct-heal', confirmed: true }
          ]
        }
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const field = (embeds, name) => fieldsOf(embeds).find((f) => f.name === name)?.value;

test('renderSpellcoef groups spells by type and leads with the penalty note', () => {
  const { embeds } = renderSpellcoef({ store, bracket: '19', className: 'mage' });
  const e = embeds[0].toJSON();

  assert.ok(e.title.includes('Mage'));
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('Sub-20 penalty'), 'leads with the penalty note');

  const direct = field(embeds, 'Direct damage');
  assert.ok(direct.includes('Frostbolt') && direct.includes('0.463 per cast'));
  const dot = field(embeds, 'Damage over time');
  assert.ok(dot.includes('Fireball') && dot.includes('per tick'));
});

test('renderSpellcoef marks unverified values and notes the count in the footer', () => {
  const { embeds } = renderSpellcoef({ store, bracket: '19', className: 'mage' });
  const e = embeds[0].toJSON();
  const direct = field(embeds, 'Direct damage');
  assert.ok(direct.includes('_unverified_'), 'unconfirmed values are flagged');
  assert.ok(e.footer.text.includes('unverified'));
  assert.ok(e.footer.text.includes('WoW Classic Era 1.15.x'));
});

test('renderSpellcoef omits the unverified flag for confirmed values', () => {
  const { embeds } = renderSpellcoef({ store, bracket: '19', className: 'priest' });
  const heal = field(embeds, 'Direct heal');
  assert.ok(heal.includes('Lesser Heal') && heal.includes('0.446 per cast'));
  assert.ok(!heal.includes('unverified'), 'confirmed value is not flagged');
});

test('renderSpellcoef degrades cleanly for a melee-only roster class', () => {
  const { embeds } = renderSpellcoef({ store, bracket: '19', className: 'warrior' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Spell Coefficients');
  assert.ok(e.description.includes('no spell-power scaling'));
  assert.ok(e.description.includes('attack power'));
});

test('renderSpellcoef degrades for an unknown class and an unloaded bracket', () => {
  const unknown = renderSpellcoef({ store, bracket: '19', className: 'dragon' });
  assert.ok(unknown.embeds[0].toJSON().description.includes('Dragon'));

  const noData = renderSpellcoef({ store, bracket: '49', className: 'mage' });
  assert.ok(noData.embeds[0].toJSON().description.includes('49'));
});
