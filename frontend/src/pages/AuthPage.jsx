import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { requestRegisterCode } from '../api.js';
import { Loader2 } from 'lucide-react';
import { BsCaretLeftFill, BsEyeFill, BsEyeSlashFill } from 'react-icons/bs';
import { errMsg } from '../utils.js';
import Silk from '../components/Silk.jsx';

/* ─────────────────────────────────────────────────────────
 * AUTH — 登录/注册合并页。/login 与 /register 渲染同一组件
 * （React 复用实例，切换路由不重挂载），左侧 Silk 品牌面板常驻，
 * 仅右侧表单区按 mode 键控切换，入场走 fade-up 过渡。
 * ───────────────────────────────────────────────────────── */

const RESEND_SECONDS = 60;
const FORM_ANIM = 'fade-up 400ms cubic-bezier(0.23,1,0.32,1) both';
const INPUT_CLS =
  'rb-auth-input w-full !rounded-[14px] border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 text-sm text-neutral-900 transition-colors focus:outline-none';
const LABEL_CLS = 'mb-2 block text-xs font-medium text-neutral-700';
const SUBMIT_CLS =
  'mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-brand-600 px-4 py-2.5 sm:py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

const ErrorBlock = ({ err }) =>
  err ? (
    <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-red">{err}</div>
  ) : null;

const SubmitButton = ({ loading, idleText }) => (
  <button type="submit" disabled={loading} className={SUBMIT_CLS}>
    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
    {loading ? `${idleText.slice(0, 2)}中…` : idleText}
  </button>
);

function LoginForm() {
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
    <div style={{ animation: FORM_ANIM }}>
      <div className="mb-5">
        <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight tracking-tight text-neutral-900">
          欢迎回来
        </h1>
        <p className="mt-1.5 sm:mt-2.5 text-[13px] sm:text-sm text-neutral-500">输入用户名或邮箱登录</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS} htmlFor="login-username">
            用户名或邮箱
          </label>
          <input
            id="login-username"
            className={INPUT_CLS}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="login-password">
            密码
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPwd ? 'text' : 'password'}
              className={`${INPUT_CLS} pr-11`}
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

        <ErrorBlock err={err} />
        <SubmitButton loading={loading} idleText="登录" />
      </form>

      <p className="mt-4 text-center text-sm text-neutral-500">
        还没有账号？{' '}
        <Link to="/register" className="font-medium text-brand-600 transition-colors hover:text-brand-700">
          注册账号
        </Link>
      </p>
    </div>
  );
}

function RegisterForm() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [showPwd, setShowPwd] = useState(false);

  // 验证码重发倒计时；归零后清除定时器。
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setInterval(() => setResendIn((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const requestCode = async () => {
    if (!email.trim() || resendIn > 0 || sending) return;
    setErr('');
    setSending(true);
    try {
      await requestRegisterCode(email.trim());
      setResendIn(RESEND_SECONDS);
    } catch (error) {
      setErr(errMsg(error, '验证码发送失败'));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      await register({ username: username.trim(), email: email.trim(), password, code: code.trim() });
      nav('/');
    } catch (error) {
      setErr(errMsg(error, '注册失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ animation: FORM_ANIM }}>
      <div className="mb-5">
        <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight tracking-tight text-neutral-900">
          注册账号
        </h1>
        <p className="mt-1.5 sm:mt-2.5 text-[13px] sm:text-sm text-neutral-500">
          使用邮箱验证码注册普通用户账号
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS} htmlFor="register-username">
            用户名
          </label>
          <input
            id="register-username"
            className={INPUT_CLS}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            autoComplete="username"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="register-email">
            邮箱
          </label>
          <input
            id="register-email"
            type="email"
            className={INPUT_CLS}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="register-code">
            邮箱验证码
          </label>
          <div className="flex gap-2">
            <input
              id="register-code"
              inputMode="numeric"
              maxLength={6}
              className={`${INPUT_CLS} min-w-0`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoComplete="one-time-code"
            />
            <button
              type="button"
              onClick={requestCode}
              disabled={resendIn > 0 || sending || !email.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[14px] bg-neutral-100 px-3.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              {resendIn > 0 ? `${resendIn}s 后重发` : '获取验证码'}
            </button>
          </div>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="register-password">
            密码
          </label>
          <div className="relative">
            <input
              id="register-password"
              type={showPwd ? 'text' : 'password'}
              className={`${INPUT_CLS} pr-11`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
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

        <ErrorBlock err={err} />
        <SubmitButton loading={loading} idleText="注册" />
      </form>

      <p className="mt-4 text-center text-sm text-neutral-500">
        已有账号？{' '}
        <Link to="/login" className="font-medium text-brand-600 transition-colors hover:text-brand-700">
          去登录
        </Link>
      </p>
    </div>
  );
}

export default function AuthPage() {
  const mode = useLocation().pathname === '/register' ? 'register' : 'login';

  return (
    <div className="flex min-h-[calc(100vh-24px)] items-center justify-center">
      <div className="relative mx-auto w-full max-w-[1100px] grid items-stretch overflow-hidden rounded-[14px] sm:h-[655px] sm:grid-cols-[1.15fr_1fr]">
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

      {/* Right — auth forms (pure white)。品牌行/页脚常驻，仅表单区按 mode 切换 */}
      <div className="relative flex w-full items-center justify-center bg-white px-5 pt-6 pb-[76px] sm:px-14 sm:pt-0 sm:pb-14">
        <div className="w-full max-w-[360px]">
          <Link
            to="/"
            className="mb-4 sm:mb-8 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-900 sm:hidden"
          >
            <BsCaretLeftFill className="w-4 h-4" />
            返回
          </Link>

          <div className="mb-4 sm:mb-8 flex items-center justify-center gap-2.5">
            <img src="/favicon.png" alt="仲英学辅" className="h-9 w-9 rounded-full object-cover" />
            <span className="text-[22px] sm:text-[26px] font-bold tracking-tight text-neutral-900">
              仲英学辅
            </span>
          </div>

          <div key={mode}>{mode === 'register' ? <RegisterForm /> : <LoginForm />}</div>

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
