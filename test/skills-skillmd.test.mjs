import { test } from 'node:test';
import assert from 'node:assert/strict';

// Node 23.6+ strips TypeScript types natively; pure lib modules have no imports.
import { parseSkillMd, matchesQuery, topSkills } from '../lib/skills-skillmd.ts';

test('parseSkillMd: valid frontmatter with comma tags', () => {
  const text = [
    '---',
    'name: my-skill',
    'description: Does a thing',
    'tags: one, two,three',
    '---',
    '# Body here',
    'More markdown.',
  ].join('\n');
  const p = parseSkillMd(text, '/skills/my-skill/SKILL.md');
  assert.equal(p.name, 'my-skill');
  assert.equal(p.description, 'Does a thing');
  assert.deepEqual(p.tags, ['one', 'two', 'three']);
  assert.equal(p.body, '# Body here\nMore markdown.');
  assert.equal(p.sourcePath, '/skills/my-skill/SKILL.md');
});

test('parseSkillMd: valid frontmatter with YAML list tags', () => {
  const text = [
    '---',
    'name: other',
    'description: Another thing',
    'tags:',
    '  - alpha',
    '  - beta',
    '---',
    'Body only.',
  ].join('\n');
  const p = parseSkillMd(text, '/skills/other/SKILL.md');
  assert.deepEqual(p.tags, ['alpha', 'beta']);
  assert.equal(p.body, 'Body only.');
});

test('parseSkillMd: missing frontmatter throws', () => {
  assert.throws(() => parseSkillMd('no frontmatter here', 'x'), /frontmatter/i);
});

test('parseSkillMd: missing name throws', () => {
  const text = '---\ndescription: hi\n---\nbody';
  assert.throws(() => parseSkillMd(text, 'x'), /name/i);
});

test('parseSkillMd: missing description throws', () => {
  const text = '---\nname: foo\n---\nbody';
  assert.throws(() => parseSkillMd(text, 'x'), /description/i);
});

test('matchesQuery: name match scores higher than tag-only match', () => {
  const named = parseSkillMd('---\nname: deploy-hermes\ndescription: x\ntags: misc\n---\n', 'a');
  const tagged = parseSkillMd('---\nname: other-thing\ndescription: y\ntags: deploy\n---\n', 'b');
  const q = 'deploy';
  assert.ok(matchesQuery(named, q) > matchesQuery(tagged, q));
  assert.ok(matchesQuery(named, q) > 0);
  assert.ok(matchesQuery(named, q) <= 1);
});

test('topSkills: sorted desc, ties by name, capped at n', () => {
  const mk = (name, desc, tags) =>
    parseSkillMd(`---\nname: ${name}\ndescription: ${desc}\ntags: ${tags}\n---\n`, name);
  const skills = [
    mk('zeta', 'deploy helper', ''),
    mk('alpha', 'deploy helper', ''),   // tie with zeta on score; alpha sorts first
    mk('beta', 'unrelated', 'deploy'),  // lower score (tag only)
    mk('gamma', 'nothing', ''),
  ];
  const top = topSkills(skills, 'deploy', 2);
  assert.equal(top.length, 2);
  assert.deepEqual(top.map((s) => s.name), ['alpha', 'zeta']);
});
