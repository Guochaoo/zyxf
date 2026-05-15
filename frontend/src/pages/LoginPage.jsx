import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { LogIn } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      await login(username, password);
      nav('/');
    } catch (e) {
      setErr(e.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto mt-12 bg-white/10 backdrop-blur-md rounded-xl shadow-sm border border-white/10 p-6">
      <h1 className="text-xl font-semibold mb-1 flex items-center gap-2 text-white">
        <LogIn className="w-5 h-5 text-brand-400" />
        管理员登录
      </h1>
      <p className="text-xs text-slate-400 mb-5">游客无需登录即可浏览和预览。</p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          className="w-full border border-white/20 bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          className="w-full border border-white/20 bg-white/5 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="text-sm text-red-500">{err}</div>}
        <button
          disabled={loading}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium"
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
