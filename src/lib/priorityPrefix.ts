import { PriorityLetter } from '../types';

export type PriorityPrefix = {
  letter: PriorityLetter;
  number: number | null;
  rest: string;
  matched: boolean;
  letterOnly: boolean;
};

/**
 * タスク内容から重要度・緊急度の明示トークンを取り出す（v0.6.4〜、v0.7.2 で数字のみの解釈を厳しくした）。
 *
 * 明示として認めるもの:
 * - 先頭の「B1」「Ａ３」（1〜20）。後ろに空白がなくてもよい（従来どおりの明示書式）
 * - 先頭の「B」「A」（その直後が空白か末尾）
 * - 先頭の数字のみ「5」「３」（1〜20）は、直後が空白か末尾のときだけ。
 *   「3Dプリンター」「10時の会議」のような、数字が単語の一部である場合はタイトルを削らない
 * - 文中・文末の独立した語「B1」「Ｂ２」（前後が空白か文頭・文末）
 *
 * タイトルを削るのは、上の明示トークンに一致したときだけ。
 */
export const parsePriorityPrefix = (text: string): PriorityPrefix => {
  const original = text.trim();
  const normalized = original.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const cut = (len: number) => original.substring(len).replace(/^[\s　]+/, '');
  const both = normalized.match(/^([A-Ca-c])([0-9]{1,2})/);
  if (both) {
    const num = parseInt(both[2], 10);
    if (num >= 1 && num <= 20) {
      return { letter: both[1].toUpperCase() as PriorityLetter, number: num, rest: cut(1 + both[2].length), matched: true, letterOnly: false };
    }
  }
  const letter = normalized.match(/^([A-Ca-c])(?:[\s　]+|$)/);
  if (letter) {
    return { letter: letter[1].toUpperCase() as PriorityLetter, number: null, rest: cut(1), matched: true, letterOnly: true };
  }
  // v0.7.2: 数字のみは「5 企画書」のように区切られているか、タイトルが数字だけのときだけ
  const num = normalized.match(/^([0-9]{1,2})(?:[\s　]+|$)/);
  if (num) {
    const n = parseInt(num[1], 10);
    if (n >= 1 && n <= 20) {
      return { letter: '', number: n, rest: cut(num[1].length), matched: true, letterOnly: false };
    }
  }
  const mid = normalized.match(/(^|[\s　])([A-Ca-c])([0-9]{1,2})(?=[\s　]|$)/);
  if (mid && mid.index !== undefined) {
    const n = parseInt(mid[3], 10);
    if (n >= 1 && n <= 20) {
      const start = mid.index + mid[1].length;
      const end = start + 1 + mid[3].length;
      const rest = (original.substring(0, start) + original.substring(end)).replace(/[\s　]{2,}/g, ' ').trim();
      return { letter: mid[2].toUpperCase() as PriorityLetter, number: n, rest, matched: true, letterOnly: false };
    }
  }
  return { letter: '', number: null, rest: original, matched: false, letterOnly: false };
};

/** 明示トークンを除いたタイトル。トークンだけだった場合は元の文字列を残す。 */
export const titleAfterPriorityPrefix = (text: string): { parsed: PriorityPrefix; title: string } => {
  const parsed = parsePriorityPrefix(text);
  const title = parsed.matched && parsed.rest.trim() ? parsed.rest : text.trim();
  return { parsed, title };
};
