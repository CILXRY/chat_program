import { LoaderCircle, Save } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useChatStore } from '../../../lib/store';
import Avatar from '../Avatar';

const AVATAR_PALETTE = [
  '#8b7cff',
  '#4dd4c0',
  '#ff9f6e',
  '#ff7a90',
  '#6fb7ff',
  '#f2c94c',
  '#b58cff',
  '#5ee2a0',
];

export default function AccountTab() {
  const me = useChatStore((state) => state.me);
  const [displayName, setDisplayName] = useState(me?.display_name ?? '');
  const [avatarColor, setAvatarColor] = useState(me?.avatar_color ?? AVATAR_PALETTE[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const dirty =
    displayName.trim() !== me.display_name || avatarColor.toLowerCase() !== me.avatar_color;

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const name = displayName.trim();
    if (!name) {
      setError('显示名称不能为空。');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const updated = await api.updateProfile({
        display_name: name,
        avatar_color: avatarColor,
      });
      useChatStore.getState().replaceMe(updated);
      useChatStore.getState().showToast('个人资料已更新', 'info');
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 422) {
        setError('显示名称需要 1–32 个字符，头像颜色必须是十六进制色值。');
      } else {
        setError('保存失败，请稍后再试。');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-mist-100">个人资料</h3>
        <p className="mt-1 text-xs leading-5 text-mist-500">
          显示名称和头像颜色会同步给工作区里的所有成员。
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <Avatar
          user={{ display_name: displayName || me.display_name, avatar_color: avatarColor }}
          size={56}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-mist-100">
            {displayName.trim() || me.display_name}
          </p>
          <p className="truncate text-[11px] text-mist-500">@{me.username}</p>
          <span className="mt-1 inline-flex rounded-full bg-base-800 px-2 py-0.5 text-[10px] text-mist-400">
            {me.role === 'admin' ? '管理员' : '成员'}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="settings-display-name" className="mb-1.5 block text-xs font-medium text-mist-400">
          显示名称
        </label>
        <input
          id="settings-display-name"
          value={displayName}
          maxLength={32}
          onChange={(event) => setDisplayName(event.target.value)}
          className="h-11 w-full rounded-xl border border-base-700 bg-base-950/60 px-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
        />
      </div>

      <div>
        <span className="mb-2 block text-xs font-medium text-mist-400">头像颜色</span>
        <div className="flex flex-wrap gap-2">
          {AVATAR_PALETTE.map((color) => {
            const selected = color === avatarColor.toLowerCase();
            return (
              <button
                key={color}
                type="button"
                onClick={() => setAvatarColor(color)}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  selected
                    ? 'scale-110 border-white/80'
                    : 'border-transparent hover:scale-105 hover:border-white/30'
                }`}
                style={{ backgroundColor: color }}
                aria-label={`选择头像颜色 ${color}`}
                aria-pressed={selected}
              />
            );
          })}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-mist-400">用户名</span>
        <p className="rounded-xl border border-white/[0.05] bg-base-950/40 px-3 py-2.5 text-sm text-mist-500">
          @{me.username}
          <span className="ml-2 text-[11px] text-mist-600">用户名不可修改</span>
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-danger-400/20 bg-danger-400/10 px-3 py-2 text-xs text-danger-400">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="flex h-10 items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
          保存资料
        </button>
      </div>
    </form>
  );
}
