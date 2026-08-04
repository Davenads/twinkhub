import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTalents, validateEmojiRegistry } from '../../src/content/schema.js';
import { classIcon, talentIcon, classIconComponent, talentsForClass, listTalentClasses } from '../../src/content/store.js';

const validTalents = () => ({
  note: 'Level-19 builds.',
  credit: { source: 'Community doc' },
  byClass: {
    druid: [
      {
        id: 'druid-grasp',
        name: "Nature's Grasp",
        summary: 'Root on hit.',
        points: "1/1 Nature's Grasp, 5/5 Furor",
        url: 'https://www.wowhead.com/classic/talent-calc/embed/druid/14000005',
        default: true,
        nodes: [
          { talent: "Nature's Grasp", rank: 1, max: 1, emoji: 'NaturesGrasp' },
          { talent: 'Furor', rank: 5, max: 5, emoji: 'Furor' }
        ]
      }
    ]
  }
});

test('validateTalents accepts a well-formed file', () => {
  assert.deepEqual(validateTalents(validTalents(), '19/talents.json'), { ok: true, errors: [] });
});

test('validateTalents rejects a duplicate build id within a class', () => {
  const t = validTalents();
  t.byClass.druid.push({ ...t.byClass.druid[0] });
  const r = validateTalents(t, '19/talents.json');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('duplicated')));
});

test('validateTalents rejects a build missing required fields and bad node ranks', () => {
  const t = validTalents();
  delete t.byClass.druid[0].points;
  t.byClass.druid[0].nodes[0].rank = -1;
  t.byClass.druid[0].nodes[1].max = 0;
  const r = validateTalents(t, '19/talents.json');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('points')));
  assert.ok(r.errors.some((e) => e.includes('rank')));
  assert.ok(r.errors.some((e) => e.includes('max')));
});

test('validateTalents rejects an empty byClass and a non-object', () => {
  assert.equal(validateTalents({ byClass: {} }, 'x').ok, false);
  assert.equal(validateTalents(null, 'x').ok, false);
});

test('validateEmojiRegistry accepts filled and empty ids', () => {
  const reg = {
    note: 'registry',
    classes: { druid: { name: 'classicon_druid', id: '123' } },
    nodes: { Furor: { name: 'Furor', id: '' }, Ann: { name: 'Ann', id: '9', animated: true } }
  };
  assert.deepEqual(validateEmojiRegistry(reg, 'emoji.json'), { ok: true, errors: [] });
});

test('validateEmojiRegistry rejects a non-string id and missing name', () => {
  assert.equal(validateEmojiRegistry({ nodes: { X: { name: 'X', id: 5 } } }, 'e').ok, false);
  assert.equal(validateEmojiRegistry({ nodes: { X: { id: '5' } } }, 'e').ok, false);
});

const store = {
  emoji: {
    classes: { druid: { name: 'classicon_druid', id: '111' }, warrior: { name: 'classicon_warrior', id: '' } },
    nodes: { Furor: { name: 'Furor', id: '222' }, NaturesGrasp: { name: 'NaturesGrasp', id: '' } }
  },
  brackets: { 19: { talents: { byClass: { druid: [{ id: 'a' }] } } } }
};

test('classIcon/talentIcon render markup when the id is filled, "" otherwise', () => {
  assert.equal(classIcon(store, 'druid'), '<:classicon_druid:111>');
  assert.equal(classIcon(store, 'warrior'), '', 'empty id degrades to text-only');
  assert.equal(classIcon(store, 'nobody'), '');
  assert.equal(talentIcon(store, 'Furor'), '<:Furor:222>');
  assert.equal(talentIcon(store, 'NaturesGrasp'), '', 'empty id degrades to text-only');
  assert.equal(talentIcon(store, 'Missing'), '');
});

test('classIconComponent returns a discord.js emoji object or null', () => {
  assert.deepEqual(classIconComponent(store, 'druid'), { id: '111', name: 'classicon_druid', animated: false });
  assert.equal(classIconComponent(store, 'warrior'), null, 'unfilled id yields null');
  assert.equal(classIconComponent(store, 'nobody'), null);
});

test('talents accessors read the bracket bundle', () => {
  assert.deepEqual(listTalentClasses(store, '19'), ['druid']);
  assert.equal(talentsForClass(store, '19', 'druid').length, 1);
  assert.equal(talentsForClass(store, '19', 'warrior'), null);
});
