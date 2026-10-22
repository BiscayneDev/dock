import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_WATERMARK,
  shouldProcess,
  nextWatermark,
  parseWatermarkRow,
} from '../lib/watermarks.ts';

test('NO_WATERMARK processes everything', () => {
  assert.equal(shouldProcess({ id: 'a', createdAt: '2026-01-01T00:00:00Z' }, NO_WATERMARK), true);
  assert.equal(NO_WATERMARK.lastItemId, null);
  assert.equal(NO_WATERMARK.seenAt, null);
});

test('dedupe on same id', () => {
  const wm = { seenAt: '2026-01-01T00:00:00Z', lastItemId: 'a' };
  assert.equal(shouldProcess({ id: 'a', createdAt: '2026-02-01T00:00:00Z' }, wm), false);
});

test('dedupe on older-or-equal createdAt', () => {
  const wm = { seenAt: '2026-02-01T00:00:00Z', lastItemId: 'x' };
  assert.equal(shouldProcess({ id: 'b', createdAt: '2026-01-31T23:59:59Z' }, wm), false);
  assert.equal(shouldProcess({ id: 'b', createdAt: '2026-02-01T00:00:00Z' }, wm), false);
});

test('process newer item', () => {
  const wm = { seenAt: '2026-01-01T00:00:00Z', lastItemId: 'x' };
  assert.equal(shouldProcess({ id: 'b', createdAt: '2026-01-02T00:00:00Z' }, wm), true);
});

test('nextWatermark picks newest, tie -> first encountered', () => {
  const processed = [
    { id: 'a', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'b', createdAt: '2026-01-03T00:00:00Z' },
    { id: 'c', createdAt: '2026-01-03T00:00:00Z' },
  ];
  const next = nextWatermark(processed, NO_WATERMARK);
  assert.equal(next.lastItemId, 'b');
  assert.equal(next.seenAt, '2026-01-03T00:00:00Z');
});

test('nextWatermark empty processed returns current', () => {
  const current = { seenAt: '2026-01-01T00:00:00Z', lastItemId: 'x' };
  assert.deepEqual(nextWatermark([], current), current);
});

test('parseWatermarkRow tolerant cases', () => {
  assert.deepEqual(parseWatermarkRow(null), NO_WATERMARK);
  assert.deepEqual(parseWatermarkRow({}), NO_WATERMARK);
  assert.deepEqual(parseWatermarkRow({ value: 'garbage' }), NO_WATERMARK);
  assert.deepEqual(parseWatermarkRow({ value: { seenAt: '2026-01-01T00:00:00Z', lastItemId: 'a' } }), {
    seenAt: '2026-01-01T00:00:00Z',
    lastItemId: 'a',
  });
  assert.deepEqual(parseWatermarkRow({ value: { seenAt: 123, lastItemId: 'a' } }), NO_WATERMARK);
});
