import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../src/mobile/plan-validator.mjs';
const W = (path, text = 'x') => ({ op: 'write', path, text });
test('accepts a bounded plan and returns only op/path/text', () => { const v = validatePlan([{ op: 'read', path: 'a.txt' }, W('src/b.txt')]); assert.equal(v.ok, true); assert.deepEqual(v.steps, [{ op: 'read', path: 'a.txt' }, { op: 'write', path: 'src/b.txt', text: 'x' }]); });
const cases = [
    ['not a list', { op: 'write' }, /not a list/], ['empty', [], /empty/], ['too many', Array.from({ length: 21 }, () => ({ op: 'read', path: 'a' })), /too many/],
    ['extra command field', [{ ...W('a'), cmd: ['id'] }], /not allowed/], ['enforcement field', [{ op: 'read', path: 'a', enforcement: 'x' }], /not allowed/], ['identity field', [{ op: 'read', path: 'a', owner: 'y', model: 'm' }], /not allowed/],
    ['exec op', [{ op: 'exec', path: 'a' }], /operation/], ['traversal', [W('../a')], /path/], ['inner traversal', [W('a/../../b')], /path/], ['absolute', [W('/etc/x')], /path/], ['backslash', [W('a\\b')], /path/], ['nul', [W('a\0b')], /path/],
    ['git dir', [W('.git/config')], /git metadata/], ['git hooks nested', [W('x/.git/hooks/h')], /git metadata/], ['gitmodules', [W('.gitmodules')], /git metadata/], ['empty segment', [W('a//b')], /path/],
    ['too large text', [W('a', 'z'.repeat(100_001))], /too large/], ['total too large', [W('a', 'z'.repeat(100_000)), W('b', 'z'.repeat(100_000)), W('c', 'z'.repeat(100_000)), W('d', 'z')], /too large/],
    ['read with text', [{ op: 'read', path: 'a', text: 'x' }], /not allowed/], ['non-plain object', [Object.create({ op: 'read', path: 'a' })], /plain object/], ['write without text', [{ op: 'write', path: 'a' }], /no text/],
];
for (const [name, plan, re] of cases) test('rejects ' + name, () => { const v = validatePlan(plan); assert.equal(v.ok, false); assert.match(v.reason, re); assert.equal(v.steps, undefined); });
test('one bad step rejects the whole plan (no partial acceptance)', () => assert.equal(validatePlan([W('ok'), W('../bad')]).ok, false));
