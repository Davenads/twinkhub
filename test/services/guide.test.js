import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGuide, renderGuideIndex } from '../../src/services/guide.js';
import { loadContentStore, classIcon } from '../../src/content/store.js';

// Synthetic fixture: a multi-section guide (to exercise real pagination), a
// class-scoped guide, and a catalogued-but-unauthored slug.
const sections = Array.from({ length: 7 }, (_, i) => ({ heading: `H${i + 1}`, body: `Body ${i + 1}` }));
const store = {
  brackets: {
    19: {
      meta: { battleground: 'Warsong Gulch', levelCap: 19, gameVersion: { clientPatch: '1.15.x' } },
      guides: {
        note: 'Curated guides.',
        list: [
          { slug: 'basics', title: 'The Basics', summary: 'Start here.', tags: ['beginner', 'xp'] },
          { slug: 'hunter-pets', title: 'Hunter Pets', summary: 'Pet families.', class: 'hunter', tags: ['pets'] },
          { slug: 'coming-soon', title: 'Coming Soon', summary: 'Not authored yet.' }
        ],
        bySlug: {
          basics: { slug: 'basics', title: 'The Basics', summary: 'Start here.', tags: ['beginner'], sections },
          'hunter-pets': { slug: 'hunter-pets', title: 'Hunter Pets', summary: 'Pet families.', class: 'hunter', sections: [{ heading: 'Families', body: 'Cats, bats.' }] }
        }
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];

test('renderGuide shows page 1 with the summary and the first sections', () => {
  const { embeds } = renderGuide({ store, bracket: '19', slug: 'basics', page: 1 });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'The Basics');
  assert.equal(e.description, 'Start here.');
  assert.deepEqual(fieldsOf(embeds).map((f) => f.name), ['H1', 'H2', 'H3', 'H4', 'H5']);
  assert.ok(e.footer.text.includes('Page 1/2'));
  assert.ok(e.footer.text.includes('next: /guide slug:basics page:2'));
  assert.ok(e.footer.text.includes('WoW Classic Era 1.15.x'));
});

test('renderGuide page 2 shows the remaining sections, no summary, no next hint', () => {
  const { embeds } = renderGuide({ store, bracket: '19', slug: 'basics', page: 2 });
  const e = embeds[0].toJSON();
  assert.deepEqual(fieldsOf(embeds).map((f) => f.name), ['H6', 'H7']);
  assert.equal(e.description, undefined, 'summary only on page 1');
  assert.ok(e.footer.text.includes('Page 2/2'));
  assert.ok(!e.footer.text.includes('next:'), 'no next hint on the last page');
});

test('renderGuide clamps an out-of-range page into bounds', () => {
  const high = renderGuide({ store, bracket: '19', slug: 'basics', page: 99 });
  assert.ok(high.embeds[0].toJSON().footer.text.includes('Page 2/2'));
  const low = renderGuide({ store, bracket: '19', slug: 'basics', page: 0 });
  assert.ok(low.embeds[0].toJSON().footer.text.includes('Page 1/2'));
});

test('renderGuide is slug case-insensitive and hides pagination for a single-page guide', () => {
  const { embeds } = renderGuide({ store, bracket: '19', slug: 'Hunter-Pets' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Hunter Pets');
  assert.ok(!e.footer.text.includes('Page'), 'single-page guide shows no page footer');
});

test('renderGuide degrades for an unknown slug, an unauthored slug, and an unloaded bracket', () => {
  const unknown = renderGuide({ store, bracket: '19', slug: 'nope' });
  assert.ok(unknown.embeds[0].toJSON().description.includes('No guide with slug'));

  const unauthored = renderGuide({ store, bracket: '19', slug: 'coming-soon' });
  assert.ok(unauthored.embeds[0].toJSON().description.includes('catalogued but not authored'));

  const noData = renderGuide({ store, bracket: '49', slug: 'basics' });
  assert.ok(noData.embeds[0].toJSON().description.includes('No guides are loaded'));
});

test('renderGuideIndex lists the catalogue and marks unauthored guides', () => {
  const { embeds } = renderGuideIndex({ store, bracket: '19' });
  const e = embeds[0].toJSON();
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('Curated guides.'));
  const names = fieldsOf(embeds).map((f) => f.name);
  assert.deepEqual(names, ['The Basics', 'Hunter Pets', 'Coming Soon']);
  const comingSoon = fieldsOf(embeds).find((f) => f.name === 'Coming Soon');
  assert.ok(comingSoon.value.includes('(coming soon)'));
});

test('renderGuideIndex filters by tag and by class (universal guides always show)', () => {
  const byTag = renderGuideIndex({ store, bracket: '19', tag: 'pets' });
  assert.deepEqual(fieldsOf(byTag.embeds).map((f) => f.name), ['Hunter Pets']);

  const byClass = renderGuideIndex({ store, bracket: '19', className: 'hunter' });
  const names = fieldsOf(byClass.embeds).map((f) => f.name);
  assert.ok(names.includes('Hunter Pets'), 'class-scoped guide shows');
  assert.ok(names.includes('The Basics'), 'universal (class-less) guide shows');
});

test('renderGuideIndex degrades on no match and on an unloaded bracket', () => {
  const noMatch = renderGuideIndex({ store, bracket: '19', tag: 'nonexistent' });
  assert.ok(noMatch.embeds[0].toJSON().description.includes('No guides match'));

  const noData = renderGuideIndex({ store, bracket: '49' });
  assert.ok(noData.embeds[0].toJSON().description.includes('No guides are loaded'));
});

test('renderGuide/Index run over the real seeded content store', async () => {
  const real = await loadContentStore({ strict: true });
  const one = renderGuide({ store: real, bracket: '19', slug: '19-twink-basics' });
  assert.ok(fieldsOf(one.embeds).length > 0, 'real guide renders sections');
  const dir = renderGuideIndex({ store: real, bracket: '19' });
  assert.ok(fieldsOf(dir.embeds).some((f) => f.value.includes('19-twink-basics')));

  // The roles & composition guide renders and browses under its strategy tag.
  const roles = renderGuide({ store: real, bracket: '19', slug: '19-wsg-roles' });
  assert.ok(fieldsOf(roles.embeds).length > 0, 'roles guide renders sections');
  const strat = renderGuideIndex({ store: real, bracket: '19', tag: 'strategy' });
  assert.ok(fieldsOf(strat.embeds).some((f) => f.value.includes('19-wsg-roles')));

  // Bolded class names carry their icon emoji, and each class in a listing sits
  // on its own line (per-class newline spacing).
  const healers = fieldsOf(roles.embeds).find((f) => f.name === 'Healers anchor the premade');
  assert.ok(healers, 'healers section present');
  const priestIcon = classIcon(real, 'priest');
  assert.ok(priestIcon, 'priest icon resolves from the real store');
  assert.ok(healers.value.includes(`${priestIcon} **Priest**`), 'class icon prefixes the bolded name');
  assert.ok(healers.value.includes(`\n${classIcon(real, 'paladin')} **Paladin**`), 'each class starts a new line');
});
