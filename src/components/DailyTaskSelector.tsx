import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Task } from '../types';
import { getLocalDateString, addDays, parseLocalDate } from '../lib/dates';

interface DailyTaskSelectorProps {
  selectedDate: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
  tasks: Task[];
}

export default function DailyTaskSelector({ selectedDate, onDateChange, tasks }: DailyTaskSelectorProps) {
  // Quick dates
  const todayStr = getLocalDateString();
  const tomorrowStr = addDays(todayStr, 1);

  // Navigate day by day
  const handleOffsetDay = (offset: number) => {
    onDateChange(addDays(selectedDate, offset));
  };

  // Get tasks for selected date
  const dayTasks = tasks.filter((t) => t.dueDate === selectedDate);
  const completedTasksCount = dayTasks.filter((t) => t.status === 'completed').length;
  const totalTasksCount = dayTasks.length;
  const completionPercentage = totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  // Format Japanese display date: e.g. "2026年6月25日 (木)"
  const getFormattedDisplayDate = (dateStr: string) => {
    const date = parseLocalDate(dateStr);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = weekdays[date.getDay()];
    return `${year}年${month}月${day}日 (${dayOfWeek})`;
  };

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-2xl p-4 shadow-sm" id="daily-task-selector">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Date Selector navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOffsetDay(-1)}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            id="btn-prev-day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-zinc-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && onDateChange(e.target.value)}
              className="font-medium text-sm text-zinc-800 dark:text-zinc-200 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer"
              id="date-picker-input"
            />
          </div>

          <button
            onClick={() => handleOffsetDay(1)}
            className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            id="btn-next-day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="flex gap-1 ml-2">
            <button
              onClick={() => onDateChange(todayStr)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedDate === todayStr
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                  : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
              }`}
              id="btn-quick-today"
            >
              今日
            </button>
            <button
              onClick={() => onDateChange(tomorrowStr)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedDate === tomorrowStr
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                  : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
              }`}
              id="btn-quick-tomorrow"
            >
              明日
            </button>
          </div>
        </div>

        {/* Selected Date Summary & Completion Stats */}
        <div className="flex items-center gap-4">
          <div className="text-left md:text-right">
            <div className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">選択中の日付</div>
            <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {getFormattedDisplayDate(selectedDate)}
            </div>
          </div>

          {/* Circle progress or percentage bar */}
          <div className="flex items-center gap-2 border-l border-zinc-100 dark:border-zinc-800 pl-4">
            <div className="relative flex items-center justify-center">
              <svg className="w-10 h-10 transform -rotate-90">
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  className="text-zinc-100 dark:text-zinc-800"
                />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 16}`}
                  strokeDashoffset={`${2 * Math.PI * 16 * (1 - completionPercentage / 100)}`}
                  className="text-zinc-900 dark:text-zinc-100 transition-all duration-300"
                />
              </svg>
              <span className="absolute text-[0.8125rem] font-bold text-zinc-700 dark:text-zinc-300">
                {completionPercentage}%
              </span>
            </div>
            <div className="text-xs">
              <div className="font-bold text-zinc-700 dark:text-zinc-300">{completedTasksCount} / {totalTasksCount} 完了</div>
              <div className="text-zinc-400 dark:text-zinc-500">デイリー進捗</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
