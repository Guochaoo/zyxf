import { useEffect, useState } from 'react';
import { getStats } from '../api.js';
import { formatSize } from '../utils.js';
import { BarChart3, Download, FileText, FolderTree, HardDrive } from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((e) => setErr(e.response?.data?.error || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-16 text-center text-slate-400">
        <div className="animate-spin w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full mx-auto mb-2" />
        加载中…
      </div>
    );
  }

  if (err) {
    return <div className="py-16 text-center text-red-500">{err}</div>;
  }

  if (!stats) return null;

  const cards = [
    {
      label: '今日下载量',
      value: stats.today_downloads,
      icon: Download,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
    },
    {
      label: '文件总数',
      value: stats.total_files,
      icon: FileText,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
    },
    {
      label: '文件夹总数',
      value: stats.total_folders,
      icon: FolderTree,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
    },
    {
      label: '总存储空间',
      value: formatSize(stats.total_size),
      icon: HardDrive,
      color: 'text-purple-500',
      bg: 'bg-purple-50',
    },
  ];

  const maxCount = Math.max(...stats.downloads_by_day.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-white flex items-center gap-2">
        <BarChart3 className="w-6 h-6 text-brand-600" />
        统计仪表盘
      </h1>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white/10 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col gap-2 hover:bg-white/15 transition-all"
          >
            <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center`}>
              <c.icon className={`w-5 h-5 ${c.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{c.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bar chart — last 7 days downloads */}
      <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-4">近 7 天下载量</h2>
        <div className="bar-chart flex items-end gap-3 h-40 px-2">
          {stats.downloads_by_day.map((d, i) => {
            const h = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
            return (
              <div
                key={d.date}
                className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
              >
                <span className="text-xs font-medium text-slate-300">{d.count}</span>
                <div
                  className="bar w-full rounded-t-md bg-brand-500 hover:bg-brand-600 transition-colors"
                  style={{
                    '--bar-h': `${h}%`,
                    height: '0%',
                    animationDelay: `${0.1 + i * 0.08}s`,
                    animationFillMode: 'forwards',
                  }}
                />
                <span className="text-xs text-slate-400 mt-1">{d.date}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
