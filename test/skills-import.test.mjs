import { test } from 'node:test';
import assert from 'node:assert/strict';

// Node 23.6+ strips TypeScript types natively; pure lib modules have no imports.
import { findSkillMdPaths } from '../lib/skills-skillmd.ts';

test('findSkillMdPaths: nested SKILL.md candidates', () => {
  assert.deepEqual(
    findSkillMdPaths(['github', 'weather', 'notes.txt', 'README.md']),
    ['github/SKILL.md', 'weather/SKILL.md', 'notes.txt/SKILL.md', 'README.md/SKILL.md']
  );
});

test('findSkillMdPaths: includes top-level SKILL.md first', () => {
  assert.deepEqual(
    findSkillMdPaths(['SKILL.md', 'foo']),
    ['SKILL.md', 'foo/SKILL.md']
  );
});

test('findSkillMdPaths: skips dotfiles and empty dirs', () => {
  assert.deepEqual(findSkillMdPaths(['.hidden', '.git']), []);
});
