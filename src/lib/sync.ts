import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { Task } from '../types';
import { db } from './firebase';

const tasksCol = (uid: string) => collection(db, 'users', uid, 'tasks');

const stripUndefined = (task: Task): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    id: task.id,
    userId: task.userId,
    title: task.title,
    notes: task.notes ?? '',
    priorityLetter: task.priorityLetter ?? '',
    priorityNumber: task.priorityNumber ?? null,
    quadrant: task.quadrant,
    dueDate: task.dueDate ?? '',
    reminderTime: task.reminderTime ?? '',
    reminderEnabled: !!task.reminderEnabled,
    reminderNotified: !!task.reminderNotified,
    completed: task.status === 'completed' || !!task.completed,
    status: task.status,
    completedAt: task.completedAt ?? null,
    completedDate: task.completedDate ?? '',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    copiedFromId: task.copiedFromId ?? null,
  };
  return payload;
};

const fromFirestore = (data: Record<string, unknown>, fallbackId: string): Task => {
  const status = (data.status as Task['status']) || (data.completed ? 'completed' : 'pending');
  return {
    id: (data.id as string) || fallbackId,
    userId: (data.userId as string) || '',
    title: (data.title as string) || '',
    notes: (data.notes as string) || '',
    priorityLetter: (data.priorityLetter as Task['priorityLetter']) || '',
    priorityNumber: (data.priorityNumber as number | null) ?? null,
    quadrant: (data.quadrant as Task['quadrant']) || 'IV',
    dueDate: (data.dueDate as string) || '',
    reminderTime: (data.reminderTime as string) || '',
    reminderEnabled: !!data.reminderEnabled,
    reminderNotified: !!data.reminderNotified,
    completed: status === 'completed',
    status,
    completedAt: (data.completedAt as string | null) ?? null,
    completedDate: (data.completedDate as string) || '',
    createdAt: (data.createdAt as string) || new Date().toISOString(),
    updatedAt: (data.updatedAt as string) || new Date().toISOString(),
    copiedFromId: (data.copiedFromId as string | null) || undefined,
  };
};

export const subscribeToUserTasks = (
  uid: string,
  onChange: (tasks: Task[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  return onSnapshot(
    tasksCol(uid),
    (snapshot) => {
      const tasks = snapshot.docs.map((d) => fromFirestore(d.data() as Record<string, unknown>, d.id));
      onChange(tasks);
    },
    (error) => {
      console.error('Firestore購読エラー:', error);
      if (onError) onError(error);
    }
  );
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

export const pushUserTasks = async (uid: string, tasks: Task[]): Promise<void> => {
  const colRef = tasksCol(uid);
  // Read current docs from the latest snapshot cache first via a one-shot listener alternative:
  // We write all current tasks and delete docs not in the set by tracking via a second pass.
  // getDocs is imported lazily to keep the module surface small.
  const { getDocs } = await import('firebase/firestore');
  const existing = await getDocs(colRef);
  const keep = new Set(tasks.map((t) => t.id));

  const ops: Array<{ type: 'set' | 'delete'; id: string; task?: Task }> = [
    ...tasks.map((task) => ({ type: 'set' as const, id: task.id, task: { ...task, userId: uid } })),
    ...existing.docs
      .filter((d) => !keep.has(d.id))
      .map((d) => ({ type: 'delete' as const, id: d.id })),
  ];

  for (const group of chunk(ops, 450)) {
    const batch = writeBatch(db);
    for (const op of group) {
      const ref = doc(colRef, op.id);
      if (op.type === 'delete') {
        batch.delete(ref);
      } else if (op.task) {
        batch.set(ref, stripUndefined(op.task));
      }
    }
    await batch.commit();
  }
};
