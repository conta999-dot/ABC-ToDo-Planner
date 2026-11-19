import React, { useState } from 'react';
import { Edit2, Trash2, Calendar, Bell, Search, Filter } from 'lucide-react';
import { Task, TaskQuadrant, getTaskQuadrant, getStatusSymbol, TaskStatus } from '../types';

interface TaskListProps {
  tasks: Task[];
  filterQuadrant: TaskQuadrant | null;
  selectedDate: string;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
}

export default function TaskList({
  tasks,
  filterQuadrant,
  selectedDate,
  onSelectTask,
  onDeleteTask,
  onStatusChange,
}: TaskListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all_active'); // all_active, pending, completed, etc.

  // 1. Filter tasks
  const filteredTasks = tasks.filter((task) => {
    // A. Quadrant Filter
    const currentQuadrant = getTaskQuadrant(task.priorityLetter, task.priorityNumber);
    if (filterQuadrant && currentQuadrant !== filterQuadrant) {
      return false;
    }

    // B. Search Filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const titleMatch = task.title.toLowerCase().includes(query);
      const notesMatch = task.notes?.toLowerCase().includes(query) || false;
      if (!titleMatch && !notesMatch) return false;
    }

    // C. Status Filter
    // By default we don't show deleted tasks unless explicitly filter is 'deleted'
    if (statusFilter === 'all_active') {
      return true; // Keep deleted tasks visible
    } else if (statusFilter === 'all') {
      return true; // Show everything including deleted
    } else if (statusFilter === 'pending_or_progress') {
      return task.status === 'pending' || task.status === 'in_progress';
    } else {
      return task.status === statusFilter;
    }
  });

  // 2. Sort tasks: Due Date (ascending, empty at bottom), then Priority Letter (A > B > C > none), then Priority Number (1 > 2 > 3 > none), then Title
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    // 1. Due Date sorting (ascending, empty/invalid at bottom)
    const dateA = a.dueDate || '9999-12-31';
    const dateB = b.dueDate || '9999-12-31';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    // 2. Priority Letter sorting
    const letterWeight = { A: 10, B: 5, C: 2, '': 0 };
    const weightA = letterWeight[a.priorityLetter || ''] || 0;
    const weightB = letterWeight[b.priorityLetter || ''] || 0;
    if (weightA !== weightB) {
      return weightB - weightA; // Descending weight (A has higher weight than B)
    }

    // 3. Priority Number sorting
    const numA = a.priorityNumber === null ? 999 : a.priorityNumber;
    const numB = b.priorityNumber === null ? 999 : b.priorityNumber;
    if (numA !== numB) {
      return numA - numB; // Ascending number (1 is higher priority than 2, 3...)
    }

    // 4. Title sorting (ascending)
    return (a.title || '').localeCompare(b.title || '');
  });

  // Get status details for cell rendering
  const getStatusDisplayInfo = (status: TaskStatus) => {
    const symbol = getStatusSymbol(status);
    switch (status) {
      case 'completed':
        return {
          symbol,
          bg: 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40',
          label: '完了'
        };
      case 'postponed':
        return {
          symbol,
          bg: 'bg-sky-50 dark:bg-sky-950/20 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800/40',
          label: '先送り'
        };
      case 'delegated':
        return {
          symbol,
          bg: 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/40',
          label: '委任'
        };
      case 'in_progress':
        return {
          symbol,
          bg: 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40',
          label: '進行中'
        };
      case 'deleted':
        return {
          symbol,
          bg: 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40 line-through',
          label: '削除'
        };
      default:
        return {
          symbol: '',
          bg: 'bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-zinc-200 dark:border-zinc-800',
          label: '未達成'
        };
    }
  };

  // Toggle status cycling or popup
  const handleCycleStatus = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid selecting row
    const cycleOrder: TaskStatus[] = ['pending', 'in_progress', 'completed', 'postponed', 'delegated', 'deleted'];
    const currentIndex = cycleOrder.indexOf(task.status || 'pending');
    const nextIndex = (currentIndex + 1) % cycleOrder.length;
    onStatusChange(task.id, cycleOrder[nextIndex]);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-5 shadow-sm" id="task-list-section">
      
      {/* Search and Filters bar */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4 mb-4">
        
        {/* Title & Info */}
        <div className="flex items-center gap-2 self-start">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            {filterQuadrant ? `第${filterQuadrant}領域のタスク一覧` : 'タスク一覧・管理'}
          </h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-bold">
            {sortedTasks.length} 件
          </span>
        </div>

        {/* Filters and Inputs */}
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto items-center">
          
          {/* Search Input */}
          <div className="relative w-full sm:w-48">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              placeholder="キーワード検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-800 dark:text-zinc-200"
              id="search-tasks-input"
            />
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative w-full sm:w-auto flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-zinc-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none text-zinc-800 dark:text-zinc-200 font-medium"
              id="status-filter-select"
            >
              <option value="all_active">有効な全タスク (削除除く)</option>
              <option value="pending_or_progress">未達成・進行中</option>
              <option value="pending">未達成のみ</option>
              <option value="in_progress">進行中のみ</option>
              <option value="completed">完了のみ</option>
              <option value="postponed">先送りのみ</option>
              <option value="delegated">委任のみ</option>
              <option value="deleted">削除のみ</option>
              <option value="all">すべてのタスク (削除含む)</option>
            </select>
          </div>

        </div>
      </div>

      {/* Task Table Display */}
      <div className="overflow-x-auto" id="tasks-table-wrapper">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50/50 dark:bg-zinc-800/20 border-b border-zinc-100 dark:border-zinc-800 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider">
              {/* Core User Request: Change "完" column header to "達成状況" */}
              <th className="w-24 py-2 px-3 text-center">達成状況</th>
              <th className="w-16 py-2 px-1 text-center">優先度</th>
              <th className="py-2 px-3">タスク内容</th>
              <th className="w-28 py-2 px-2 text-center">期日</th>
              <th className="w-20 py-2 px-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {sortedTasks.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
                  該当するタスクが見つかりませんでした。
                </td>
              </tr>
            ) : (
              sortedTasks.map((task) => {
                const statusInfo = getStatusDisplayInfo(task.status || 'pending');

                return (
                  <tr
                    key={task.id}
                    className={`group hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer ${
                      task.status === 'completed' ? 'opacity-65' : ''
                    } ${task.status === 'deleted' ? 'bg-red-50/10 opacity-50' : ''}`}
                    onClick={() => onSelectTask(task)}
                    id={`task-row-${task.id}`}
                  >
                    {/* Status Symbol Box (Core User Request) */}
                    <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => handleCycleStatus(task, e)}
                        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border text-xs font-black transition-all hover:scale-105 active:scale-95 ${statusInfo.bg}`}
                        title={`クリックしてステータスを変更 (${statusInfo.label})`}
                        id={`btn-status-cycle-${task.id}`}
                      >
                        {statusInfo.symbol || (
                          <div className="w-4 h-4 rounded-full border border-zinc-300 dark:border-zinc-700 hover:border-zinc-500" />
                        )}
                      </button>
                    </td>

                    {/* Priority Badge */}
                    <td className="py-2 px-1 text-center font-bold text-xs" onClick={() => onSelectTask(task)}>
                      {task.priorityLetter ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[0.8125rem] font-black tracking-wide ${
                          task.priorityLetter === 'A'
                            ? 'bg-red-500 text-white'
                            : task.priorityLetter === 'B'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-zinc-500 text-white'
                        }`}>
                          {task.priorityLetter}{task.priorityNumber || ''}
                        </span>
                      ) : (
                        <span className="text-zinc-300 dark:text-zinc-700">-</span>
                      )}
                    </td>

                    {/* Task Title & Notes Preview */}
                    <td className="py-2 px-3 text-xs" onClick={() => onSelectTask(task)}>
                      <div className="flex flex-col gap-0.5">
                        <span className={`font-semibold text-zinc-800 dark:text-zinc-200 ${
                          task.status === 'completed' ? 'line-through text-zinc-400 dark:text-zinc-500' : ''
                        } ${task.status === 'deleted' ? 'line-through text-red-500' : ''}`}>
                          {task.title}
                        </span>
                        
                        {task.notes && (
                          <span className="text-[0.8125rem] text-zinc-400 dark:text-zinc-500 truncate max-w-sm font-medium">
                            {task.notes}
                          </span>
                        )}

                        {/* Reminder Badge if any */}
                        {task.reminderEnabled && task.reminderTime && (
                          <div className="flex items-center gap-1 text-[0.75rem] font-semibold text-sky-500 mt-0.5">
                            <Bell className="w-2.5 h-2.5" />
                            <span>通知 {task.reminderTime}</span>
                            {task.reminderNotified && (
                              <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 px-1 rounded">通知済</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Due Date */}
                    <td className="py-2 px-2 text-center text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500" onClick={() => onSelectTask(task)}>
                      <div className="flex items-center justify-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>{task.dueDate === selectedDate ? '今日' : task.dueDate}</span>
                      </div>
                    </td>

                    {/* Operations */}
                    <td className="py-2 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onSelectTask(task)}
                          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                          title="編集"
                          id={`btn-edit-task-${task.id}`}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-1 text-zinc-400 hover:text-red-500 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
                          title="削除"
                          id={`btn-delete-task-${task.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Helper Guide about symbols */}
      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-zinc-400 dark:text-zinc-500 font-semibold" id="status-guide-legend">
        <span>【達成状況 記号凡例】</span>
        <span>未達成: (空欄)</span>
        <span className="text-emerald-500">完了: ✓</span>
        <span className="text-sky-500">先送り: →</span>
        <span className="text-indigo-500">委任: ○</span>
        <span className="text-amber-500">進行中: ・</span>
        <span className="text-red-500">削除: ×</span>
      </div>

    </div>
  );
}
