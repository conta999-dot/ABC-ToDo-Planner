import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePriorityPrefix, titleAfterPriorityPrefix } from './priorityPrefix';

test('3Dプリンター… is not an urgency token (the reported bug)', () => {
  for (const input of ['3Dプリンター置き場の確保', '３Dプリンター置き場の確保', '3D printer', '10時の会議', '2階の掃除', '12月の予定']) {
    const p = parsePriorityPrefix(input);
    assert.equal(p.matched, false, input);
    assert.equal(titleAfterPriorityPrefix(input).title, input);
  }
});

test('a leading number is urgency only with a separator or as the whole title', () => {
  const spaced = parsePriorityPrefix('5 企画書を提出');
  assert.equal(spaced.matched, true);
  assert.equal(spaced.letter, '');
  assert.equal(spaced.number, 5);
  assert.equal(spaced.rest, '企画書を提出');
  const zenkaku = parsePriorityPrefix('３　置き場の確保');
  assert.equal(zenkaku.matched, true);
  assert.equal(zenkaku.number, 3);
  assert.equal(zenkaku.rest, '置き場の確保');
  const only = titleAfterPriorityPrefix('3');
  assert.equal(only.parsed.matched, true);
  assert.equal(only.parsed.number, 3);
  assert.equal(only.title, '3');
});

test('explicit B1 / Ｂ２ at start or mid-text still works', () => {
  const start = parsePriorityPrefix('B1会議');
  assert.deepEqual({ letter: start.letter, number: start.number, rest: start.rest, matched: start.matched }, { letter: 'B', number: 1, rest: '会議', matched: true });
  const wide = parsePriorityPrefix('Ｂ２ 買い物');
  assert.equal(wide.letter, 'B');
  assert.equal(wide.number, 2);
  assert.equal(wide.rest, '買い物');
  const mid = parsePriorityPrefix('準備 B9 完了');
  assert.equal(mid.letter, 'B');
  assert.equal(mid.number, 9);
  assert.equal(mid.rest, '準備 完了');
});

test('letter only still needs a separator', () => {
  const ok = parsePriorityPrefix('A 企画書');
  assert.equal(ok.matched, true);
  assert.equal(ok.letter, 'A');
  assert.equal(ok.letterOnly, true);
  assert.equal(ok.rest, '企画書');
  const no = parsePriorityPrefix('ABC会議');
  assert.equal(no.matched, false);
});
