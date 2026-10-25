import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import {
  clearLastLogin,
  readLastLogin,
  writeLastLogin,
  type LastLogin,
} from '../../lib/lastLogin';

interface Props {
  mode: 'login' | 'register';
  next?: string;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '用户名或密码不正确。';
    if (error.status === 403) return '这个账号已被移除，请联系管理员。';
    if (error.status === 409) return '这个用户名已经被占用了，换一个试试。';
    if (error.status === 422) {
      return '请检查输入：用户名 3–24 位（字母、数字、下划线），密码至少 8 位。';
    }
    if (error.status === 0) return '无法连接到服务器，请确认 API 已启动。';
    if (typeof error.detail === 'string') return error.detail;
    return '操作失败，请稍后再试。';
  }
  return '网络出了点问题，请稍后再试。';
}

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export default function AuthForm({ mode, next }: Props) {
  const isRegister = mode === 'register';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickLogin, setQuickLogin] = useState<LastLogin | null>(() => readLastLogin());
  const passwordRef = useRef<HTMLInputElement>(null);

  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const switchQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  function useQuickLogin(entry: LastLogin) {
    setUsername(entry.username);
    setRemember(entry.remember);
    setError(null);
    passwordRef.current?.focus();
  }

  function dismissQuickLogin() {
    clearLastLogin();
    setQuickLogin(null);
    setUsername('');
    setPassword('');
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);

    try {
      if (isRegister) {
        const user = await api.register({
          username: username.trim(),
          display_name: displayName.trim() || undefined,
          password,
        });
        writeLastLogin({
          username: user.username,
          display_name: user.display_name,
          avatar_color: user.avatar_color,
          remember: true,
        });
      } else {
        const user = await api.login(username.trim(), password, remember);
        writeLastLogin({
          username: user.username,
          display_name: user.display_name,
          avatar_color: user.avatar_color,
          remember,
        });
      }
      window.location.assign(target);
    } catch (submitError) {
      setError(describeError(submitError));
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isRegister && quickLogin && (
        <div className="animate-fade-in rounded-2xl border border-accent-500/20 bg-accent-500/[0.06] p-3">
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: quickLogin.avatar_color }}
            >
              {initialOf(quickLogin.display_name)}
            </span>
            <button
              type="button"
              onClick={() => useQuickLogin(quickLogin)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-sm font-medium text-mist-100">
                继续作为 {quickLogin.display_name}
              </span>
              <span className="block truncate text-[11px] text-mist-500">
                @{quickLogin.username} · 点击填入用户名
              </span>
            </button>
            <button
              type="button"
              onClick={() => useQuickLogin(quickLogin)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-500/15 text-accent-300 transition hover:bg-accent-500/25"
              aria-label={`继续使用 ${quickLogin.display_name} 登录`}
              title="继续登录"
            >
              <ArrowRight size={15} />
            </button>
          </div>
          <button
            type="button"
            onClick={dismissQuickLogin}
            className="mt-1.5 flex items-center gap-1 pl-[52px] text-[11px] text-mist-500 transition hover:text-mist-300"
          >
            <X size={11} />
            不是本人？清除记录
          </button>
        </div>
      )}

      <div>
        <label htmlFor="username" className="mb-1.5 block text-xs font-medium text-mist-400">
          用户名
        </label>
        <div className="relative">
          <UserRound
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-600"
          />
          <input
            id="username"
            name="username"
            required
            autoFocus
            autoComplete="username"
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_]+"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="例如 alice"
            className="h-11 w-full rounded-xl border border-base-700 bg-base-950/70 pl-10 pr-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
          />
        </div>
        {isRegister && (
          <p className="mt-1.5 text-[11px] text-mist-600">
            3–24 位，小写字母、数字或下划线。
          </p>
        )}
      </div>

      {isRegister && (
        <div>
          <label
            htmlFor="displayName"
            className="mb-1.5 block text-xs font-medium text-mist-400"
          >
            显示名称 <span className="font-normal text-mist-600">（可选）</span>
          </label>
          <div className="relative">
            <Sparkles
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-600"
            />
            <input
              id="displayName"
              name="displayName"
              autoComplete="nickname"
              maxLength={32}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="别人看到的名字"
              className="h-11 w-full rounded-xl border border-base-700 bg-base-950/70 pl-10 pr-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-mist-400">
          密码
        </label>
        <div className="relative">
          <LockKeyhole
            size={17}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-600"
          />
          <input
            id="password"
            name="password"
            ref={passwordRef}
            required
            minLength={isRegister ? 8 : 1}
            maxLength={72}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isRegister ? '至少 8 位' : '输入你的密码'}
            className="h-11 w-full rounded-xl border border-base-700 bg-base-950/70 pl-10 pr-11 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-mist-500 transition hover:bg-white/5 hover:text-mist-300"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {!isRegister && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-mist-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-base-600 bg-base-950 accent-accent-500"
          />
          记住我（30 天内免登录）
        </label>
      )}

      {error && (
        <div
          role="alert"
          className="animate-fade-in rounded-xl border border-danger-400/20 bg-danger-400/10 px-3.5 py-2.5 text-xs leading-5 text-danger-400"
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="group mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 text-sm font-semibold text-white shadow-[0_12px_30px_-12px_rgba(139,124,255,0.9)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <LoaderCircle size={17} className="animate-spin" />
        ) : (
          <>
            {isRegister ? '创建账号' : '登录'}
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </>
        )}
      </button>

      <p className="pt-1 text-center text-xs text-mist-500">
        {isRegister ? '已经有账号了？' : '还没有账号？'}{' '}
        <a
          href={`${isRegister ? '/login' : '/register'}${switchQuery}`}
          className="font-medium text-accent-300 transition hover:text-accent-400"
        >
          {isRegister ? '去登录' : '创建一个'}
        </a>
      </p>
    </form>
  );
}
