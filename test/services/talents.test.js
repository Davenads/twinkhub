import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTalents } from '../../src/services/talents.js';

const store = {
  emoji: {
    classes: {
      druid: { name: 'classicon_druid', id: '111' },
      warrior: { name: 'classicon_warrior', id: '' }
    },
    nodes: {
      Furor: { name: 'Furor', id: '222' },
      NaturesGrasp: { name: 'NaturesGrasp', id: '' }
    }
  },
  brackets: {
    19: {
      meta: { battleground: 'Warsong Gulch', levelCap: 19, gameVersion: { clientPatch: '1.15.x' } },
      classes: { index: { classes: [{ class: 'druid' }, { class: 'warrior' }, { class: 'priest' }] }, byClass: {} },
      talents: {
        note: 'Level-19 builds.',
        credit: { source: 'Community doc', url: 'https://example.com/doc' },
        byClass: {
          druid: [
            {
              id: 'druid-grasp-shifter',
              name: "Nature's Grasp / Furor",
              role: 'flag-carrier',
              default: true,
              summary: 'Root on hit plus rage-fed shifting.',
              points: "1/1 Nature's Grasp, 5/5 Furor",
              url: 'https://www.wowhead.com/classic/talent-calc/embed/druid/14000005',
              nodes: [
                { talent: "Nature's Grasp", rank: 1, max: 1, emoji: 'NaturesGrasp' },
                { talent: 'Furor', rank: 5, max: 5, emoji: 'Furor' }
              ]
            }
          ]
        }
      }
    }
  }
};

const fieldsOf = (embeds) => embeds[0].toJSON().fields ?? [];

test('renderTalents lists all builds with the class icon in the description', () => {
  const { embeds } = renderTalents({ store, bracket: '19', className: 'druid' });
  const e = embeds[0].toJSON();
  assert.ok(e.title.includes('Druid'));
  assert.ok(e.title.includes('Warsong Gulch 19'));
  assert.ok(e.description.includes('<:classicon_druid:111>'), 'class icon renders in description');
  assert.ok(e.description.includes('Community doc'), 'credit line present');

  const f = fieldsOf(embeds).find((x) => x.name.includes("Nature's Grasp / Furor"));
  assert.ok(f, 'build field present');
  assert.ok(f.name.includes('default'), 'default build tagged');
  assert.ok(f.value.includes('<:Furor:222> 5/5 Furor'), 'filled node emoji renders in value');
  assert.ok(f.value.includes('1/1 Nature'), "unfilled node degrades to text");
  assert.ok(!f.value.includes('<:NaturesGrasp:'), 'empty-id node has no broken markup');
  assert.ok(f.value.includes('Open in Wowhead'), 'wowhead link present');
});

test('renderTalents narrows to a single build with a per-node breakdown', () => {
  const { embeds } = renderTalents({ store, bracket: '19', className: 'druid', build: 'druid-grasp-shifter' });
  const fields = fieldsOf(embeds);
  assert.ok(fields.some((f) => f.name === 'Points'), 'points field present');
  assert.ok(fields.some((f) => f.name === 'Nodes'), 'nodes field present');
  assert.ok(fields.some((f) => f.name === 'Talent calculator'));
});

test('renderTalents degrades for an unknown build id', () => {
  const { embeds } = renderTalents({ store, bracket: '19', className: 'druid', build: 'nope' });
  assert.ok(embeds[0].toJSON().description.includes('nope'));
});

test('renderTalents degrades for a roster class with no authored builds', () => {
  const { embeds } = renderTalents({ store, bracket: '19', className: 'priest' });
  const e = embeds[0].toJSON();
  assert.equal(e.title, 'Talent Builds');
  assert.ok(e.description.includes('No talent builds are authored'));
});

test('renderTalents degrades for an unknown class and an unloaded bracket', () => {
  const unknown = renderTalents({ store, bracket: '19', className: 'dragon' });
  assert.ok(unknown.embeds[0].toJSON().description.includes('Dragon'));

  const noData = renderTalents({ store, bracket: '49', className: 'druid' });
  assert.ok(noData.embeds[0].toJSON().description.includes('49'));
});
