import { Task } from '../types';

const LOCAL_STORAGE_KEY = 'abc_planner_tasks_v1';

export const getLocalTasks = (): Task[] => {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    return parsed.map((task) => {
      let status = task.status;
      if (!status) {
        status = task.completed ? 'completed' : 'pending';
      }
      return {
        ...task,
        status,
        completed: status === 'completed',
      };
    });
  } catch (e) {
    console.error('Failed to parse local tasks:', e);
    return [];
  }
};

export const saveLocalTasks = (tasks: Task[]) => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    console.error('Failed to save local tasks:', e);
  }
};

export const dbService = {
  async getTasks(): Promise<Task[]> {
    return getLocalTasks();
  },
  async saveTasks(tasks: Task[]): Promise<void> {
    saveLocalTasks(tasks);
  }
};
