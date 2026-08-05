import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentStore } from '../../src/content/store.js';
import { renderClassHub } from '../../src/services/classhub.js';

test('renderClassHub builds a neutral overview embed from class content', async () => {
  const store = await loadContentStore();
  const { embeds } = renderClassHub({ store, bracket: '19', className: 'rogue' });
  const json = embeds[0].toJSON();

  assert.match(json.title, /Rogue/, 'titles the class');
  // Neutral landing: no gear yet, prompts the user to pick a build.
  assert.match(json.description, /Pick a build/i, 'prompts a build choice');
  assert.match(json.description, /Tier S/, 'summarises tier');
  // Faction notes surface as a field (rogue authors them).
  assert.ok(json.fields.some((f) => f.name === 'Faction notes'), 'faction notes field present');
});

test('renderClassHub degrades cleanly for an unknown class', async () => {
  const store = await loadContentStore();
  const { embeds } = renderClassHub({ store, bracket: '19', className: 'nonexistent' });
  assert.match(embeds[0].toJSON().description, /No class/i);
});
