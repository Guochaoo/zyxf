import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Loader2 } from 'lucide-react';
import { BsCaretLeftFill, BsEyeFill, BsEyeSlashFill } from 'react-icons/bs';
import { errMsg } from '../utils.js';
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
    } catch (error) {
      setErr(errMsg(error, '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-24px)] items-center justify-center">
      <div className="relative mx-auto w-full max-w-[1100px] grid items-stretch overflow-hidden rounded-[14px] sm:min-h-[655px] sm:grid-cols-[1.15fr_1fr]">
      {/* Left — silky brand panel with animated Silk background */}
      <div className="rb-dark relative z-0 hidden sm:flex sm:flex-col sm:justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <Silk
            speed={1}
            scale={0.9}
            color="#2d2d31"
            noiseIntensity={0.8}
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
            <span className="text-white/60">让</span>
            <span className="text-white">知识</span>
            <br />
            <span className="text-white/60">有序流动</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            整理学习资料，检索所需内容，与同学共享优质资源
          </p>
        </div>
      </div>

      {/* Right — login form (pure white) */}
      <div className="relative flex w-full items-center justify-center bg-white px-5 pt-6 pb-[76px] sm:px-14 sm:pt-0 sm:pb-14">
        <div className="w-full max-w-[360px]">
          <Link
            to="/"
            className="mb-4 sm:mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 sm:hidden"
          >
            <BsCaretLeftFill className="w-4 h-4" />
            返回
          </Link>

          <div className="mb-6 sm:mt-[5px] sm:mb-[71px] flex items-center justify-center gap-2.5">
            <img src="/favicon.png" alt="仲英学辅" className="h-9 w-9 rounded-full object-cover" />
            <span className="text-[22px] sm:text-[26px] font-bold tracking-tight text-neutral-900">
              仲英学辅
            </span>
          </div>

          <div className="mb-5 sm:mb-9">
            <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight tracking-tight text-neutral-900">
              欢迎回来
            </h1>
            <p className="mt-1.5 sm:mt-2.5 text-[13px] sm:text-sm text-neutral-500">
              目前仅支持管理员登录
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="mb-2 block text-xs font-medium text-neutral-700" htmlFor="login-username">
                用户名
              </label>
              <input
                id="login-username"
                className="rb-auth-input w-full !rounded-[14px] border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 text-sm text-neutral-900 transition-colors focus:outline-none"
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
                  className="rb-auth-input w-full !rounded-[14px] border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 pr-11 text-sm text-neutral-900 transition-colors focus:outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex w-8 h-8 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700"
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
              className="mt-2 sm:mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-brand-600 px-4 py-2.5 sm:py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? '登录中…' : '登录'}
            </button>
          </form>

          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-neutral-400 sm:bottom-6">
            由{' '}
            <Link to="/about" className="text-neutral-400 transition-colors hover:text-neutral-600">
              仲英书院学业辅导中心
            </Link>{' '}
            提供
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
