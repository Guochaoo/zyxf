import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Loader2 } from 'lucide-react';
import { BsCaretLeftFill, BsEyeFill, BsEyeSlashFill } from 'react-icons/bs';
import Silk from '../components/Silk.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

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
    <div className="relative mt-3 sm:mt-6 mx-auto w-full max-w-[1100px] grid items-stretch overflow-hidden rounded-2xl border border-white/10 shadow-2xl md:min-h-[640px] md:grid-cols-[1.15fr_1fr]">
      {/* Left — silky brand panel with animated Silk background */}
      <div className="relative hidden md:flex md:flex-col md:justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Silk
            speed={6.5}
            scale={0.8}
            color="#1f1f1f"
            noiseIntensity={0}
            rotation={0}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-black/20 via-transparent to-black/40" />
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white"
        >
          <BsCaretLeftFill className="w-4 h-4" />
          返回首页
        </Link>

        <div className="text-white">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-tight">
            让知识
            <br />
            有序流动。
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            仲英书院学业辅导中心资料库
            <br />
            管理员登录后可上传与整理资料,游客无需登录即可浏览和预览。
          </p>
        </div>
      </div>

      {/* Right — login form (pure white) */}
      <div className="login-light flex w-full items-center justify-center bg-white px-5 py-6 sm:px-14 sm:py-14">
        <div className="w-full max-w-[360px]">
          <Link
            to="/"
            className="mb-4 sm:mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 md:hidden"
          >
            <BsCaretLeftFill className="w-4 h-4" />
            返回
          </Link>

          <div className="mb-5 sm:mb-9">
            <h1 className="text-[22px] sm:text-[26px] font-semibold leading-tight tracking-tight text-neutral-900">
              管理员登录
            </h1>
            <p className="mt-1.5 sm:mt-2.5 text-[13px] sm:text-sm text-neutral-500">
              输入账号与密码继续。
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="mb-2 block text-xs font-medium text-neutral-700" htmlFor="login-username">
                用户名
              </label>
              <input
                id="login-username"
                className="w-full rounded-lg border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:bg-neutral-200/70 focus:outline-none"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-neutral-700" htmlFor="login-password">
                密码
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPwd ? 'text' : 'password'}
                  className="w-full rounded-lg border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 pr-11 text-sm text-neutral-900 placeholder:text-neutral-400 transition-colors focus:bg-neutral-200/70 focus:outline-none"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  className="login-light-eye absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700"
                >
                  {showPwd ? <BsEyeSlashFill className="w-4 h-4" /> : <BsEyeFill className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {err}
              </div>
            )}

            <button
              disabled={loading}
              className="mt-2 sm:mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 sm:py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '登录中…' : '登录'}
            </button>
          </form>

          <p className="mt-6 sm:mt-10 text-xs text-neutral-400">由 仲英书院学业辅导中心 提供</p>
        </div>
      </div>
    </div>
  );
}
