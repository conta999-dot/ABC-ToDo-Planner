import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface SaveResult {
  /** 端末の「ドキュメント」フォルダに保存できたときの場所（表示用） */
  savedPath?: string;
  /** 共有メニューを開いたか */
  shared: boolean;
}

/**
 * テキストファイルを保存する。
 * - Web: ブラウザのダウンロード
 * - Android: WebView はダウンロード（a[download] / blob:）に対応していないため、
 *   「ドキュメント/ABCToDoPlanner」に保存し、続けて共有メニュー（Googleドライブ・ファイル・メール等へ保存/送信）を開く
 */
export const saveTextFile = async (fileName: string, text: string, mimeType: string): Promise<SaveResult> => {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { shared: false };
  }

  let savedPath: string | undefined;
  try {
    await Filesystem.writeFile({
      path: `ABCToDoPlanner/${fileName}`,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    savedPath = `ドキュメント/ABCToDoPlanner/${fileName}`;
  } catch (e) {
    console.warn('ドキュメントへの保存に失敗（共有メニューのみ使用）:', e);
  }

  // 共有用の一時ファイル（アプリのキャッシュ）
  const cached = await Filesystem.writeFile({
    path: `share/${fileName}`,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  let shared = false;
  try {
    await Share.share({ title: fileName, files: [cached.uri], dialogTitle: `${fileName} を保存・送信` });
    shared = true;
  } catch (e) {
    // 共有メニューを閉じただけ（キャンセル）も例外になる
    const msg = String((e as { message?: string })?.message || e);
    if (!/cancel/i.test(msg)) console.warn('共有メニューのエラー:', e);
  }
  if (!savedPath && !shared) throw new Error('ファイルを保存できませんでした。');
  return { savedPath, shared };
};
