import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuest } from '../../src/services/quest.js';

const store = {
  brackets: {
    19: {
      meta: {
        battleground: 'Warsong Gulch',
        levelCap: 19,
        gameVersion: { clientPatch: '1.15.x' }
      },
      gear: {
        byId: { 'talbar-mantle': { id: 'talbar-mantle', name: 'Talbar Mantle', slot: 'shoulder' } }
      },
      quests: {
        note: 'Seeded from verified domain notes.',
        quests: [
          {
            id: 'the-night-watch',
            name: 'The Night Watch',
            zone: null,
            faction: 'alliance',
            reward: { desc: 'Quiver of the Night Watch' },
            xpWarning: true,
            classes: ['hunter']
          },
          {
            id: 'talbar-quest',
            name: 'Talbar Mantle Quest',
            zone: 'Redridge',
            faction: 'both',
            reward: { itemId: 'talbar-mantle' },
            xpWarning: false
          },
          {
            id: 'screecher',
            name: 'Screecher Belt Quest',
            zone: 'Silverpine',
            faction: 'horde',
            reward: { desc: 'Screecher Belt' },
            xpWarning: true
          }
        ]
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];
const field = (embeds, name) => fieldsOf(embeds).find((f) => f.name === name)?.value;
const fieldNames = (embeds) => fieldsOf(embeds).map((f) => f.name);

test('renderQuest lists quests with the file note, resolving reward itemIds to item names', () => {
  const { embeds } = renderQuest({ store, bracket: '19' });
  const e = embeds[0].toJSON();
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('Seeded from verified domain notes'));
  assert.deepEqual(fieldNames(embeds).sort(), [
    'Screecher Belt Quest',
    'Talbar Mantle Quest',
    'The Night Watch'
  ]);
  // reward.itemId resolves to the gear item's name.
  assert.ok(field(embeds, 'Talbar Mantle Quest').includes('Reward: Talbar Mantle'));
  assert.ok(e.footer.text.includes('WoW Classic Era 1.15.x'));
});

test('renderQuest flags XP-risk turn-ins and leaves safe ones unflagged', () => {
  const { embeds } = renderQuest({ store, bracket: '19' });
  assert.ok(field(embeds, 'The Night Watch').includes('XP-risk turn-in'));
  assert.ok(!field(embeds, 'Talbar Mantle Quest').includes('XP-risk turn-in'));
});

test('renderQuest faction filter keeps that faction plus both', () => {
  const { embeds } = renderQuest({ store, bracket: '19', faction: 'alliance' });
  const names = fieldNames(embeds);
  assert.ok(names.includes('The Night Watch'), 'alliance quest shown');
  assert.ok(names.includes('Talbar Mantle Quest'), 'both-faction quest shown');
  assert.ok(!names.includes('Screecher Belt Quest'), 'horde quest hidden');
});

test('renderQuest class filter keeps universal quests plus class-specific ones', () => {
  const hunter = renderQuest({ store, bracket: '19', className: 'hunter' });
  const names = fieldNames(hunter.embeds);
  assert.ok(names.includes('The Night Watch'), 'hunter quest shown');
  assert.ok(names.includes('Talbar Mantle Quest'), 'universal quest shown');
});

test('renderQuest degrades on no match and on an unloaded bracket', () => {
  // A class filter can only exclude class-specific quests (universal ones always
  // survive), so the no-match path needs a store whose quests are all scoped.
  const scoped = {
    brackets: {
      19: {
        meta: {
          battleground: 'Warsong Gulch',
          levelCap: 19,
          gameVersion: { clientPatch: '1.15.x' }
        },
        gear: { byId: {} },
        quests: {
          quests: [
            {
              id: 'q',
              name: 'Hunter Quest',
              zone: null,
              faction: 'alliance',
              reward: { desc: 'x' },
              xpWarning: false,
              classes: ['hunter']
            }
          ]
        }
      }
    }
  };
  const noMatch = renderQuest({ store: scoped, bracket: '19', className: 'rogue' });
  assert.ok(noMatch.embeds[0].toJSON().description.includes('No quests match'));

  const noData = renderQuest({ store, bracket: '49' });
  assert.ok(noData.embeds[0].toJSON().description.includes('No quest data is loaded'));
});
