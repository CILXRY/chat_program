import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api';

interface Props {
  mode: 'login' | 'register';
  next?: string;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '用户名或密码不正确。';
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

export default function AuthForm({ mode, next }: Props) {
  const isRegister = mode === 'register';
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const switchQuery = next ? `?next=${encodeURIComponent(next)}` : '';

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);

    try {
      if (isRegister) {
        await api.register({
          username: username.trim(),
          display_name: displayName.trim() || undefined,
          password,
        });
      } else {
        await api.login(username.trim(), password);
      }
      window.location.assign(target);
    } catch (submitError) {
      setError(describeError(submitError));
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
