import test from 'node:test';
import assert from 'node:assert/strict';
import { renderXpRules } from '../../src/services/xprules.js';

const store = {
  brackets: {
    19: {
      meta: {
        levelRange: [10, 19],
        levelCap: 19,
        battleground: 'Warsong Gulch',
        xpLock: { available: false, note: 'Manage XP manually.' },
        gameVersion: { clientPatch: '1.15.x' }
      }
    }
  }
};

test('renderXpRules builds the bracket embed purely from meta data', () => {
  const { embeds } = renderXpRules({ store, bracket: '19' });
  const e = embeds[0].toJSON();

  assert.equal(e.title, 'XP Rules \u2014 Warsong Gulch 10\u201319');
  assert.ok(e.description.includes('Level cap:** 19'));
  assert.ok(e.description.includes('dings 20'));
  assert.equal(e.fields[0].name, 'No XP-off toggle');
  assert.equal(e.fields[0].value, 'Manage XP manually.');
  assert.equal(e.footer.text, 'WoW Classic Era 1.15.x');
});

test('renderXpRules degrades to a clear message for an unknown bracket', () => {
  const { embeds } = renderXpRules({ store, bracket: '49' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'XP Rules');
  assert.ok(e.description.includes('49'));
  assert.equal(e.fields, undefined);
});
