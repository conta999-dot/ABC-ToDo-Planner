import { Award, AlertCircle, PhoneCall, Trash2 } from 'lucide-react';
import { Task, TaskQuadrant, getTaskQuadrant } from '../types';

interface MatrixViewProps {
  tasks: Task[];
  selectedQuadrant: TaskQuadrant | null;
  onQuadrantSelect: (quadrant: TaskQuadrant | null) => void;
}

export default function MatrixView({ tasks, selectedQuadrant, onQuadrantSelect }: MatrixViewProps) {
  // Counts only active tasks (excluding deleted ones unless specifically checked)
  const getQuadrantStats = (q: TaskQuadrant) => {
    const qTasks = tasks.filter((t) => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === q);
    const completedCount = qTasks.filter((t) => t.status === 'completed').length;
    return {
      total: qTasks.length,
      completed: completedCount,
      pending: qTasks.length - completedCount,
      tasks: qTasks,
    };
  };

  const statsI = getQuadrantStats('I');
  const statsII = getQuadrantStats('II');
  const statsIII = getQuadrantStats('III');
  const statsIV = getQuadrantStats('IV');

  const quadrantsConfig = [
    {
      id: 'I' as TaskQuadrant,
      title: '第Ⅰ領域 (必須の領域)',
      description: '重要 かつ 緊急',
      subtext: '締め切り、突発的な問題、危機対応',
      colorClass: 'border-red-100 dark:border-red-900/30 bg-red-50/30 dark:bg-red-950/10 text-red-700 dark:text-red-400',
      activeColorClass: 'ring-2 ring-red-500 bg-red-50/80 dark:bg-red-950/20 border-red-300 dark:border-red-900',
      icon: <AlertCircle className="w-5 h-5 text-red-500" />,
      stats: statsI,
    },
    {
      id: 'II' as TaskQuadrant,
      title: '第Ⅱ領域 (自己投資の領域)',
      description: '重要 かつ 緊急ではない',
      subtext: '自己啓発、計画、健康維持、人間関係',
      colorClass: 'border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-950/10 text-emerald-700 dark:text-emerald-400',
      activeColorClass: 'ring-2 ring-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-900',
      icon: <Award className="w-5 h-5 text-emerald-500" />,
      stats: statsII,
    },
    {
      id: 'III' as TaskQuadrant,
      title: '第Ⅲ領域 (錯覚の領域)',
      description: '重要ではない かつ 緊急',
      subtext: '無駄な会議、突然の来客、重要でない電話',
      colorClass: 'border-amber-100 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10 text-amber-700 dark:text-amber-400',
      activeColorClass: 'ring-2 ring-amber-500 bg-amber-50/80 dark:bg-amber-950/20 border-amber-300 dark:border-amber-900',
      icon: <PhoneCall className="w-5 h-5 text-amber-500" />,
      stats: statsIII,
    },
    {
      id: 'IV' as TaskQuadrant,
      title: '第Ⅳ領域 (無駄の領域)',
      description: '重要ではない かつ 緊急ではない',
      subtext: '時間潰し、過度の娯楽、単なる逃避行動',
      colorClass: 'border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 text-zinc-600 dark:text-zinc-400',
      activeColorClass: 'ring-2 ring-zinc-500 bg-zinc-100 dark:bg-zinc-900/60 border-zinc-300 dark:border-zinc-700',
      icon: <Trash2 className="w-5 h-5 text-zinc-400" />,
      stats: statsIV,
    },
  ];

  return (
    <div className="flex flex-col gap-4" id="matrix-view">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">時間管理マトリクス</h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
            優先順位と緊急度による４つの領域。クリックして一覧を絞り込みます。
          </p>
        </div>
        {selectedQuadrant && (
          <button
            onClick={() => onQuadrantSelect(null)}
            className="text-xs font-semibold px-2.5 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-lg transition-colors"
            id="btn-clear-quadrant-filter"
          >
            フィルター解除
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {quadrantsConfig.map((quad) => {
          const isActive = selectedQuadrant === quad.id;
          return (
            <div
              key={quad.id}
              onClick={() => onQuadrantSelect(isActive ? null : quad.id)}
              className={`border rounded-2xl p-5 cursor-pointer transition-all duration-300 flex flex-col justify-between min-h-[160px] ${
                isActive ? quad.activeColorClass : quad.colorClass
              } hover:shadow-md hover:scale-[1.01]`}
              id={`matrix-card-${quad.id}`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {quad.icon}
                    <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-100">
                      {quad.title}
                    </h3>
                  </div>
                  <span className="text-xs font-black tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    領域 {quad.id}
                  </span>
                </div>
                
                <p className="text-xs font-semibold mb-1 opacity-95">
                  {quad.description}
                </p>
                <p className="text-[11px] opacity-75 line-clamp-2 leading-relaxed">
                  {quad.subtext}
                </p>
              </div>

              {/* Stats and mini preview */}
              <div className="mt-4 pt-3 border-t border-zinc-100/50 dark:border-zinc-800/30 flex items-center justify-between">
                <div className="flex gap-4 text-xs font-bold">
                  <div>
                    <span className="text-zinc-400 mr-1">未</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{quad.stats.pending}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 mr-1">完</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{quad.stats.completed}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 mr-1">計</span>
                    <span className="text-zinc-800 dark:text-zinc-200">{quad.stats.total}</span>
                  </div>
                </div>

                {quad.stats.total > 0 && (
                  <div className="flex -space-x-1 overflow-hidden max-w-[120px] items-center gap-1">
                    <span className="text-[10px] text-zinc-400 font-medium">プレビュー ({quad.stats.tasks.length}):</span>
                    <div className="flex gap-1 overflow-x-auto max-w-[80px] scrollbar-none">
                      {quad.stats.tasks.slice(0, 3).map((t) => (
                        <span
                          key={t.id}
                          className={`text-[9px] font-black px-1 py-0.5 rounded ${
                            t.status === 'completed'
                              ? 'bg-zinc-200 text-zinc-500 line-through'
                              : 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
                          }`}
                          title={t.title}
                        >
                          {t.priorityLetter}{t.priorityNumber || ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
