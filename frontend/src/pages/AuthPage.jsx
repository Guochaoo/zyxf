import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useTranslation } from 'react-i18next';
import { requestRegisterCode } from '../api.js';
import { Loader2 } from 'lucide-react';
import { BsCaretLeftFill, BsEyeFill, BsEyeSlashFill } from 'react-icons/bs';
import { errMsg } from '../utils.js';
import Silk from '../components/Silk.jsx';
import Toast from '../components/Toast.jsx';

/* ─────────────────────────────────────────────────────────
 * AUTH — 登录/注册合并页。/login 与 /register 渲染同一组件
 * （React 复用实例，切换路由不重挂载），左侧 Silk 品牌面板常驻，
 * 仅右侧表单区按 mode 键控切换，入场走 fade-up 过渡。
 * ───────────────────────────────────────────────────────── */

const RESEND_SECONDS = 60;
const FORM_ANIM = 'fade-up 400ms cubic-bezier(0.23,1,0.32,1) both';
const INPUT_CLS =
  'rb-auth-input w-full !rounded-[14px] border-0 bg-neutral-100 px-3.5 py-2.5 sm:py-3 text-sm text-neutral-900 transition-colors focus:outline-hidden';
const LABEL_CLS = 'mb-2 block text-xs font-medium text-neutral-700';
const SUBMIT_CLS =
  'mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-brand-600 px-4 py-2.5 sm:py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60';

// 加载态文案由调用方以完整句子传入：中英构词不同（中文「X中…」/ 英文 -ing），
// 不能用「取前两字 + 后缀」拼接——那会把英文拼成 “Siing…”（BUG）。
const SubmitButton = ({ loading, idleText, loadingText }) => (
  <button type="submit" disabled={loading} className={SUBMIT_CLS}>
    {loading && <Loader2 className="w-4 h-4 animate-spin" />}
    {loading ? loadingText : idleText}
  </button>
);

// 密码输入框 + 显隐切换（登录/注册两表单共用，显隐状态各自独立）。
function PasswordInput({ id, value, onChange, autoComplete }) {
  const { t } = useTranslation();
  const [showPwd, setShowPwd] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={showPwd ? 'text' : 'password'}
        className={`${INPUT_CLS} pr-11`}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setShowPwd((v) => !v)}
        aria-label={showPwd ? t('auth.pwdHide') : t('auth.pwdShow')}
        className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex w-8 h-8 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-700"
      >
        {showPwd ? <BsEyeSlashFill className="w-4 h-4" /> : <BsEyeFill className="w-4 h-4" />}
      </button>
    </div>
  );
}

const AuthHeading = ({ title, sub }) => (
  <div className="mb-5">
    <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight tracking-tight text-neutral-900">
      {title}
    </h1>
    <p className="mt-1.5 sm:mt-2.5 text-[13px] sm:text-sm text-neutral-500">{sub}</p>
  </div>
);

const AuthSwapLink = ({ to, prompt, action }) => (
  <p className="mt-4 text-center text-sm text-neutral-500">
    {prompt}{' '}
    <Link to={to} className="font-medium text-brand-600 transition-colors hover:text-brand-700">
      {action}
    </Link>
  </p>
);

// 表单动作共享骨架：清错 → busy → await → 成功回调 / 失败提示。
// setErr 由调用方传入，让同一表单的多个动作（注册页的发码/提交）共享错误状态。
function useSubmit(setErr) {
  const [busy, setBusy] = useState(false);
  const run = async (action, fallbackMsg, onSuccess) => {
    setErr('');
    setBusy(true);
    try {
      await action();
      onSuccess?.();
    } catch (error) {
      setErr(errMsg(error, fallbackMsg));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function LoginForm() {
  const { login } = useAuth();
  const { t } = useTranslation();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const { busy: loading, run } = useSubmit(setErr);

  const onSubmit = (e) => {
    e.preventDefault();
    run(() => login(username, password), t('auth.loginFail'), () => nav('/'));
  };

  return (
    <div style={{ animation: FORM_ANIM }}>
      <AuthHeading title={t('auth.welcome')} sub={t('auth.welcomeSub')} />

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS} htmlFor="login-username">
            {t('auth.usernameOrEmail')}
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
            {t('auth.pwd')}
          </label>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        {err && <Toast type="error" message={err} onClose={() => setErr('')} />}
        <SubmitButton
          loading={loading}
          idleText={t('auth.login')}
          loadingText={t('auth.loginLoading')}
        />
      </form>

      <AuthSwapLink to="/register" prompt={t('auth.noAccount')} action={t('auth.goRegister')} />
    </div>
  );
}

function RegisterForm() {
  const { register } = useAuth();
  const { t } = useTranslation();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // 发码与提交是两个 busy 态，但共享同一 err（任一失败都显示在表单顶部）。
  const { busy: loading, run } = useSubmit(setErr);
  const { busy: sending, run: runRequest } = useSubmit(setErr);

  // 验证码重发倒计时；归零后清除定时器。
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setInterval(() => setResendIn((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const requestCode = () => {
    if (!email.trim() || resendIn > 0 || sending) return;
    runRequest(() => requestRegisterCode(email.trim()), t('auth.codeSendFail'), () => setResendIn(RESEND_SECONDS));
  };

  const onSubmit = (e) => {
    e.preventDefault();
    run(
      () => register({ username: username.trim(), email: email.trim(), password, code: code.trim() }),
      t('auth.registerFail'),
      () => nav('/')
    );
  };

  return (
    <div style={{ animation: FORM_ANIM }}>
      <AuthHeading title={t('auth.register')} sub={t('auth.registerSub')} />

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={LABEL_CLS} htmlFor="register-username">
            {t('auth.username')}
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
            {t('auth.email')}
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
            {t('auth.emailCode')}
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
              {resendIn > 0 ? t('auth.resend', { s: resendIn }) : t('auth.getCode')}
            </button>
          </div>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="register-password">
            {t('auth.pwd')}
          </label>
          <PasswordInput
            id="register-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        {err && <Toast type="error" message={err} onClose={() => setErr('')} />}
        <SubmitButton
          loading={loading}
          idleText={t('auth.registerBtn')}
          loadingText={t('auth.registerLoading')}
        />
      </form>

      <AuthSwapLink to="/login" prompt={t('auth.haveAccount')} action={t('auth.goLogin')} />
    </div>
  );
}

export default function AuthPage() {
  const { t } = useTranslation();
  const mode = useLocation().pathname === '/register' ? 'register' : 'login';

  return (
    <div className="flex min-h-[calc(100vh_-_24px)] items-center justify-center">
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
          {t('auth.backHome')}
        </Link>

        <div className="text-white">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-tight">
            <span className="text-white/60">{t('auth.brandTitle1')}</span>
            <span className="text-white">{t('auth.brandTitle2')}</span>
            <br />
            <span className="text-white/60">{t('auth.brandTitle3')}</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            {t('auth.brandSlogan')}
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
            {t('auth.back')}
          </Link>

          <div className="mb-4 sm:mb-8 flex items-center justify-center gap-2.5">
            <img src="/favicon.png" alt={t('auth.brandAlt')} className="h-9 w-9 rounded-full object-cover" />
            <span className="text-[22px] sm:text-[26px] font-bold tracking-tight text-neutral-900">
              {t('auth.brandAlt')}
            </span>
          </div>

          <div key={mode}>{mode === 'register' ? <RegisterForm /> : <LoginForm />}</div>

          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-neutral-400 sm:bottom-6">
            {t('auth.providedBy')}
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
