import { KeyRound, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useChatStore } from '../../../lib/store';

const inputClass =
  'h-11 w-full rounded-xl border border-base-700 bg-base-950/60 px-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15';

export default function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (newPassword.length < 8) {
      setError('新密码至少需要 8 位。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密码不能和当前密码相同。');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      useChatStore.getState().showToast('密码已更新', 'info');
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        setError('当前密码不正确。');
      } else if (submitError instanceof ApiError && submitError.status === 400) {
        setError('新密码不能和当前密码相同。');
      } else if (submitError instanceof ApiError && submitError.status === 422) {
        setError('新密码需要 8–72 位。');
      } else {
        setError('修改失败，请稍后再试。');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-mist-100">修改密码</h3>
        <p className="mt-1 text-xs leading-5 text-mist-500">
          修改后，已经登录的浏览器会在当前会话内保持登录。
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="current-password" className="mb-1.5 block text-xs font-medium text-mist-400">
            当前密码
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={72}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="new-password" className="mb-1.5 block text-xs font-medium text-mist-400">
            新密码
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="至少 8 位"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-medium text-mist-400">
            确认新密码
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-danger-400/20 bg-danger-400/10 px-3 py-2 text-xs text-danger-400">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !currentPassword || !newPassword || !confirmPassword}
          className="flex h-10 items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}
          更新密码
        </button>
      </div>
    </form>
  );
}
