import { Task } from '../types';

/**
 * ローカルとクラウド（Firestore）のタスクをマージする
 * 1. 共通IDのタスクは updatedAt が新しい方を採用
 * 2. 片方にしかないタスクはそのまま追加
 */
export function mergeTasks(localTasks: Task[], cloudTasks: Task[]): { merged: Task[]; updatedCount: number } {
  const mergedMap = new Map<string, Task>();
  let updatedCount = 0;

  // まずクラウドのタスクをマップに追加
  cloudTasks.forEach((task) => {
    mergedMap.set(task.id, task);
  });

  // 次にローカルのタスクをマージ
  localTasks.forEach((localTask) => {
    const cloudTask = mergedMap.get(localTask.id);
    if (!cloudTask) {
      // クラウド側にまだ存在しないタスク
      mergedMap.set(localTask.id, localTask);
      updatedCount++;
    } else {
      // 両方に存在するタスク
      const localTime = new Date(localTask.updatedAt || localTask.createdAt || 0).getTime();
      const cloudTime = new Date(cloudTask.updatedAt || cloudTask.createdAt || 0).getTime();

      if (localTime > cloudTime) {
        // ローカルの方が新しい
        mergedMap.set(localTask.id, localTask);
        updatedCount++;
      } else if (cloudTime > localTime) {
        // クラウドの方が新しい
        updatedCount++;
      }
      // 同じ場合はそのままクラウド側のタスク（同一内容）にしておく
    }
  });

  return {
    merged: Array.from(mergedMap.values()),
    updatedCount,
  };
}
