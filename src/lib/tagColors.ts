/**
 * タグの色（v0.7.3〜）。設定では色の「キー」だけを保存する（無い・不明なキーは色なし＝今までの文字色）。
 * 明るい背景用(light)と暗い背景用(dark)の2色を持ち、どちらも文字として読めるコントラストにしてある。
 */
export interface TagColor { key: string; label: string; light: string; dark: string }

export const TAG_COLORS: TagColor[] = [
  { key: 'red', label: '赤', light: '#b91c1c', dark: '#fca5a5' },
  { key: 'amber', label: '黄土', light: '#a16207', dark: '#fcd34d' },
  { key: 'green', label: '緑', light: '#15803d', dark: '#86efac' },
  { key: 'teal', label: '青緑', light: '#0f766e', dark: '#5eead4' },
  { key: 'blue', label: '青', light: '#1d4ed8', dark: '#93c5fd' },
  { key: 'purple', label: '紫', light: '#7e22ce', dark: '#d8b4fe' },
  { key: 'pink', label: 'ピンク', light: '#be185d', dark: '#f9a8d4' },
];

export const findTagColor = (key?: string | null): TagColor | undefined =>
  key ? TAG_COLORS.find((c) => c.key === key) : undefined;

/** 文字色として使う CSS 変数（.tag-colored が light / dark を切り替える） */
export const tagColorStyle = (key?: string | null): Record<string, string> | undefined => {
  const c = findTagColor(key);
  return c ? { '--tag-c-light': c.light, '--tag-c-dark': c.dark } : undefined;
};

const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrastRatio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
