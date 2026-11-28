import test from 'node:test';
import assert from 'node:assert/strict';
import { TAG_COLORS, contrastRatio, findTagColor, tagColorStyle } from './tagColors';
import { normalizeTagSettings, defaultTagSettings, setTagColor, mergeTagSettings } from './tags';
import { BLANK_TAG_ID, PRIVATE_TAG_ID } from '../types';

test('palette is readable on light (white) and dark (zinc-900) backgrounds', () => {
  for (const c of TAG_COLORS) {
    assert.ok(contrastRatio(c.light, '#ffffff') >= 4.5, `${c.key} light ${contrastRatio(c.light, '#ffffff')}`);
    assert.ok(contrastRatio(c.dark, '#18181b') >= 4.5, `${c.key} dark ${contrastRatio(c.dark, '#18181b')}`);
  }
});

test('old data without color still normalizes (no color)', () => {
  const s = normalizeTagSettings({ tags: [{ id: BLANK_TAG_ID, name: '空欄', isBlank: true }, { id: PRIVATE_TAG_ID, name: 'プライベート' }], defaultTagId: BLANK_TAG_ID, updatedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(s.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, undefined);
  assert.equal(tagColorStyle(undefined), undefined);
});

test('setTagColor sets, clears, rejects blank/unknown, and survives normalize', () => {
  const base = defaultTagSettings('2026-01-01T00:00:00.000Z');
  const r = setTagColor(base, PRIVATE_TAG_ID, 'red', '2026-02-01T00:00:00.000Z');
  assert.equal(r.settings.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, 'red');
  assert.equal(r.settings.updatedAt, '2026-02-01T00:00:00.000Z');
  const round = normalizeTagSettings(JSON.parse(JSON.stringify(r.settings)));
  assert.equal(round.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, 'red');
  const cleared = setTagColor(r.settings, PRIVATE_TAG_ID, null);
  assert.equal('color' in (cleared.settings.tags.find((t) => t.id === PRIVATE_TAG_ID) as object), false);
  assert.ok(setTagColor(base, BLANK_TAG_ID, 'red').error);
  assert.equal(setTagColor(base, PRIVATE_TAG_ID, 'nope').settings.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, undefined);
  // unknown color keys from the cloud are dropped
  const odd = normalizeTagSettings({ tags: [{ id: 'x', name: 'X', color: 'zzz' }], defaultTagId: 'x' });
  assert.equal(odd.tags.find((t) => t.id === 'x')?.color, undefined);
  assert.ok(findTagColor('blue'));
});

test('newer color change wins in merge', () => {
  const base = defaultTagSettings('2026-01-01T00:00:00.000Z');
  const local = setTagColor(base, PRIVATE_TAG_ID, 'blue', '2026-03-01T00:00:00.000Z').settings;
  assert.equal(mergeTagSettings(local, base).settings.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, 'blue');
  assert.equal(mergeTagSettings(base, local).settings.tags.find((t) => t.id === PRIVATE_TAG_ID)?.color, 'blue');
});
