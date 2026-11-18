import React, { useState, useEffect } from 'react';
import { X, Calendar, Bell, Info, Check, Trash2 } from 'lucide-react';
import { Task, PriorityLetter, TaskStatus, getTaskQuadrant, TASK_STATUS_OPTIONS } from '../types';
import { getLocalDateString } from '../lib/dates';

interface TaskFormProps {
  task?: Task | null; // If provided, we are editing, otherwise creating
  defaultDate?: string;
  onSave: (taskData: Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
}

export default function TaskForm({ task, defaultDate, onSave, onCancel, onDelete }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priorityLetter, setPriorityLetter] = useState<PriorityLetter>('');
  const [priorityNumber, setPriorityNumber] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [completedDate, setCompletedDate] = useState('');

  // Load task values if editing
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes);
      setPriorityLetter(task.priorityLetter);
      setPriorityNumber(task.priorityNumber);
      setDueDate(task.dueDate);
      setReminderTime(task.reminderTime);
      setReminderEnabled(task.reminderEnabled);
      setStatus(task.status || 'pending');
      setCompletedDate(task.completedDate || '');
    } else {
      setTitle('');
      setNotes('');
      setPriorityLetter('');
      setPriorityNumber(null);
      setDueDate(defaultDate || getLocalDateString());
      setReminderTime('');
      setReminderEnabled(false);
      setStatus('pending');
      setCompletedDate('');
    }
  }, [task, defaultDate]);

  const handleTitleChange = (val: string) => {
    setTitle(val);

    const toHalfWidth = (str: string): string => {
      return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
      });
    };

    let titleText = val.trim();
    let normalizedText = toHalfWidth(titleText);

    const matchBoth = normalizedText.match(/^([A-Ca-c])([0-9]{1,2})\s*(.*)$/);
    if (matchBoth) {
      const letter = matchBoth[1].toUpperCase() as PriorityLetter;
      const num = parseInt(matchBoth[2], 10);
      if (num >= 1 && num <= 20) {
        setPriorityLetter(letter);
        setPriorityNumber(num);
      }
    } else {
      const matchLetter = normalizedText.match(/^([A-Ca-c])\s+(.*)$/);
      const matchLetterEnd = normalizedText.match(/^([A-Ca-c])$/);
      if (matchLetter) {
        const letter = matchLetter[1].toUpperCase() as PriorityLetter;
        setPriorityLetter(letter);
        setPriorityNumber(null);
      } else if (matchLetterEnd) {
        const letter = matchLetterEnd[1].toUpperCase() as PriorityLetter;
        setPriorityLetter(letter);
        setPriorityNumber(null);
      } else {
        const matchNumber = normalizedText.match(/^([0-9]{1,2})\s*(.*)$/);
        if (matchNumber) {
          const num = parseInt(matchNumber[1], 10);
          if (num >= 1 && num <= 20) {
            setPriorityLetter('');
            setPriorityNumber(num);
          }
        }
      }
    }
  };

  const handleStatusChange = (newStatus: TaskStatus) => {
    setStatus(newStatus);
    if (newStatus === 'completed') {
      if (!completedDate) {
        setCompletedDate(getLocalDateString());
      }
    } else {
      setCompletedDate('');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('タスク内容を入力してください。');
      return;
    }

    const toHalfWidth = (str: string): string => {
      return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
      });
    };

    let finalTitle = title.trim();
    let normalizedText = toHalfWidth(finalTitle);

    let finalLetter = priorityLetter;
    let finalNumber = priorityNumber;

    const matchBoth = normalizedText.match(/^([A-Ca-c])([0-9]{1,2})\s*(.*)$/);
    if (matchBoth) {
      const letter = matchBoth[1].toUpperCase() as PriorityLetter;
      const num = parseInt(matchBoth[2], 10);
      if (num >= 1 && num <= 20) {
        finalLetter = letter;
        finalNumber = num;
        const prefixLen = matchBoth[1].length + matchBoth[2].length;
        let rest = finalTitle.substring(prefixLen);
        rest = rest.replace(/^[\s　]+/, '');
        finalTitle = rest;
      }
    } else {
      const matchLetter = normalizedText.match(/^([A-Ca-c])\s+(.*)$/);
      const matchLetterEnd = normalizedText.match(/^([A-Ca-c])$/);
      if (matchLetter) {
        finalLetter = matchLetter[1].toUpperCase() as PriorityLetter;
        finalNumber = null;
        let rest = finalTitle.substring(1);
        rest = rest.replace(/^[\s　]+/, '');
        finalTitle = rest;
      } else if (matchLetterEnd) {
        finalLetter = matchLetterEnd[1].toUpperCase() as PriorityLetter;
        finalNumber = null;
        finalTitle = '';
      } else {
        const matchNumber = normalizedText.match(/^([0-9]{1,2})\s*(.*)$/);
        if (matchNumber) {
          const num = parseInt(matchNumber[1], 10);
          if (num >= 1 && num <= 20) {
            finalLetter = '';
            finalNumber = num;
            const prefixLen = matchNumber[1].length;
            let rest = finalTitle.substring(prefixLen);
            rest = rest.replace(/^[\s　]+/, '');
            finalTitle = rest;
          }
        }
      }
    }

    if (!finalTitle.trim()) {
      finalTitle = title.trim();
    }

    const calculatedQuadrant = getTaskQuadrant(finalLetter, finalNumber);

    onSave({
      title: finalTitle,
      notes: notes.trim(),
      priorityLetter: finalLetter,
      priorityNumber: finalNumber,
      quadrant: calculatedQuadrant,
      dueDate,
      reminderTime,
      reminderEnabled,
      reminderNotified: task ? task.reminderNotified : false,
      completed: status === 'completed',
      status,
      completedAt: status === 'completed' ? (task?.completedAt || new Date().toISOString()) : null,
      completedDate: status === 'completed' ? (completedDate || getLocalDateString()) : '',
    });
  };

  const calculatedQuadrant = getTaskQuadrant(priorityLetter, priorityNumber);

  return (
    <div className="flex flex-col gap-4" id="task-form-container">
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
        <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-50" id="form-title">
          {task ? 'タスク詳細・編集' : '新しいタスクを作成'}
        </h3>
        <button
          onClick={onCancel}
          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
          id="btn-close-form"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" id="task-edit-form">
        
        {/* Title */}
        <div>
          <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-title">
            タスク内容 *
          </label>
          <input
            id="task-title"
            type="text"
            required
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="やるべきことを入力してください (例: A3 顧客への提案書作成)"
            className="w-full px-3.5 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-medium"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-notes">
            メモ・詳細
          </label>
          <textarea
            id="task-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="タスクの補足、必要な資料、関連リンクなど"
            rows={3}
            className="w-full px-3.5 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 resize-none"
          />
        </div>

        {/* Priority Matrix Setup (Letter & Number Dropdowns) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-priority-letter">
              重要度
            </label>
            <select
              id="task-priority-letter"
              value={priorityLetter}
              onChange={(e) => setPriorityLetter(e.target.value as PriorityLetter)}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-semibold"
            >
              <option value="">なし</option>
              <option value="A">A - 重要度最高 (第Ⅰ/第Ⅰ領域)</option>
              <option value="B">B - 重要 (第Ⅱ領域)</option>
              <option value="C">C - 重要ではない (第Ⅲ領域)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-priority-number">
              緊急度
            </label>
            <select
              id="task-priority-number"
              value={priorityNumber === null ? '' : priorityNumber}
              onChange={(e) => setPriorityNumber(e.target.value === '' ? null : parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-semibold"
            >
              <option value="">なし</option>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((val) => (
                <option key={val} value={val}>{val}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Quadrant Helper Box */}
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-3 border border-zinc-100 dark:border-zinc-800/50 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-zinc-700 dark:text-zinc-300">
              自動判定: 第{calculatedQuadrant}領域 (
              {calculatedQuadrant === 'I' && '第Ⅰ領域（必須の領域） - 重要(A)かつ緊急'}
              {calculatedQuadrant === 'II' && '第Ⅱ領域（自己投資の領域） - 重要(B)かつ緊急ではない'}
              {calculatedQuadrant === 'III' && '第Ⅲ領域（錯覚の領域） - 重要ではない(C)かつ緊急(数字入りすべて)'}
              {calculatedQuadrant === 'IV' && '第Ⅳ領域（無駄の領域） - 重要ではない(未設定/C)かつ緊急ではない'}
              )
            </span>
            <p className="text-zinc-400 mt-0.5 font-medium">
              優先度の英字と数字から自動判定されます。タイトルに「A3 タスク」のように入力すると、重要度(A〜C)と緊急度(1〜20)を自動で抽出・設定します。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Due Date */}
          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-due-date">
              実施予定日 / 期限
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              <input
                id="task-due-date"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-medium"
              />
            </div>
          </div>

          {/* Status Selection (Core User Request) */}
          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-status">
              達成状況 (ステータス)
            </label>
            <select
              id="task-status"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              className="w-full px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-medium"
            >
              {TASK_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} {opt.symbol ? `(${opt.symbol})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Completed Date Field (Visible constantly) */}
          <div>
            <label className="block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-1.5" htmlFor="task-completed-date">
              完了日 {status === 'completed' && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-zinc-400 pointer-events-none" />
              <input
                id="task-completed-date"
                type="date"
                required={status === 'completed'}
                value={completedDate}
                onChange={(e) => setCompletedDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50 font-medium"
              />
            </div>
          </div>
        </div>

        {/* Reminder Settings */}
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-zinc-400" />
              通知 (リマインダー)
            </span>
            <label className="relative inline-flex items-center cursor-pointer" id="lbl-reminder-toggle">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                className="sr-only peer"
                id="reminder-enabled-checkbox"
              />
              <div className="w-8 h-4 bg-zinc-200 dark:bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-zinc-900 dark:peer-checked:bg-zinc-100"></div>
            </label>
          </div>

          {reminderEnabled && (
            <div className="flex gap-2 items-center animate-fade-in">
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                required={reminderEnabled}
                className="px-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-950 dark:focus:ring-zinc-300 text-zinc-900 dark:text-zinc-50"
                id="reminder-time-input"
              />
              <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
                にデスクトップ通知を表示します。
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end items-center gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-4 mt-2">
          {task && onDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirm('このタスクを完全に削除しますか？')) {
                  onDelete(task.id);
                }
              }}
              className="mr-auto px-4 py-2 text-xs font-bold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border border-red-200 dark:border-red-900/40 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 transition-all flex items-center gap-1.5"
              id="btn-form-delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
              削除する
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
            id="btn-form-cancel"
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="px-5 py-2 text-xs font-bold bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 rounded-xl shadow-sm transition-all flex items-center gap-1.5"
            id="btn-form-submit"
          >
            <Check className="w-3.5 h-3.5" />
            保存する
          </button>
        </div>

      </form>
    </div>
  );
}
