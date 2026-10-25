import {
  LoaderCircle,
  RotateCcw,
  Shield,
  ShieldOff,
  UserMinus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useChatStore } from '../../../lib/store';
import type { User, UserRole } from '../../../lib/types';
import Avatar from '../Avatar';

export default function MembersTab() {
  const me = useChatStore((state) => state.me);
  const users = useChatStore((state) => state.users);
  const online = useChatStore((state) => state.online);
  const [removed, setRemoved] = useState<User[]>([]);
  const [loadingRemoved, setLoadingRemoved] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.role !== 'admin') return;
    let cancelled = false;
    setLoadingRemoved(true);
    api
      .getRemovedUsers()
      .then((list) => {
        if (!cancelled) setRemoved(list);
      })
      .catch(() => {
        if (!cancelled) setError('加载已移除成员失败。');
      })
      .finally(() => {
        if (!cancelled) setLoadingRemoved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [me?.role]);

  if (!me) return null;
  if (me.role !== 'admin') {
    return <p className="text-sm text-mist-500">只有管理员可以管理成员。</p>;
  }

  const onlineSet = new Set(online);
  const sorted = [...users].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.display_name.localeCompare(b.display_name, 'zh-CN');
  });

  function describeError(submitError: unknown): string {
    if (submitError instanceof ApiError) {
      if (submitError.status === 403) return '你没有权限执行这个操作。';
      if (submitError.status === 400 && typeof submitError.detail === 'string') {
        return submitError.detail;
      }
      if (submitError.status === 404) return '成员不存在。';
    }
    return '操作失败，请稍后再试。';
  }

  async function handleRole(user: User, role: UserRole) {
    if (pendingId !== null) return;
    setPendingId(user.id);
    setError(null);
    try {
      const updated = await api.setUserRole(user.id, role);
      useChatStore.getState().upsertUser(updated);
      useChatStore.getState().showToast(
        role === 'admin' ? `${user.display_name} 已成为管理员` : `${user.display_name} 已取消管理员`,
        'info',
      );
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setPendingId(null);
    }
  }

  async function handleRemove(user: User) {
    if (pendingId !== null) return;
    setPendingId(user.id);
    setError(null);
    try {
      await api.removeMember(user.id);
      useChatStore.getState().removeUser(user.id);
      setRemoved((list) => [...list, { ...user }]);
      setConfirmingId(null);
      useChatStore.getState().showToast(`已移除 ${user.display_name}，历史消息仍保留`, 'info');
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setPendingId(null);
    }
  }

  async function handleRestore(user: User) {
    if (pendingId !== null) return;
    setPendingId(user.id);
    setError(null);
    try {
      const restored = await api.restoreMember(user.id);
      useChatStore.getState().upsertUser(restored);
      setRemoved((list) => list.filter((item) => item.id !== user.id));
      useChatStore.getState().showToast(`${user.display_name} 已恢复`, 'info');
    } catch (submitError) {
      setError(describeError(submitError));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-7">
      <div>
        <h3 className="text-sm font-semibold text-mist-100">成员管理</h3>
        <p className="mt-1 text-xs leading-5 text-mist-500">
          管理员可以移除成员或调整管理员身份。被移除的账号会立即下线，聊天记录会保留。
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-danger-400/20 bg-danger-400/10 px-3 py-2 text-xs text-danger-400">
          {error}
        </p>
      )}

      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-600">
          成员 — {sorted.length}
        </h4>
        <div className="space-y-1">
          {sorted.map((user) => {
            const isSelf = user.id === me.id;
            const pending = pendingId === user.id;
            const confirming = confirmingId === user.id;
            return (
              <div
                key={user.id}
                className="flex flex-wrap items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]"
              >
                <Avatar user={user} size={32} online={onlineSet.has(user.id)} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-mist-200">
                    {user.display_name}
                    {isSelf && (
                      <span className="text-[10px] font-normal text-mist-600">你</span>
                    )}
                    {user.role === 'admin' && (
                      <span className="rounded-full border border-accent-500/25 bg-accent-500/10 px-1.5 py-px text-[9px] font-medium text-accent-300">
                        管理员
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[10px] text-mist-600">@{user.username}</p>
                </div>

                {confirming ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleRemove(user)}
                      disabled={pending}
                      className="flex h-7 items-center gap-1 rounded-lg border border-danger-400/25 bg-danger-400/10 px-2.5 text-[11px] text-danger-400 transition hover:bg-danger-400/15 disabled:opacity-60"
                    >
                      {pending && <LoaderCircle size={11} className="animate-spin" />}
                      确认移除
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="h-7 rounded-lg px-2 text-[11px] text-mist-500 transition hover:text-mist-200"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  !isSelf && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void handleRole(user, user.role === 'admin' ? 'member' : 'admin')
                        }
                        disabled={pending}
                        title={user.role === 'admin' ? '取消管理员' : '设为管理员'}
                        className="grid h-7 w-7 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-accent-300 disabled:opacity-50"
                      >
                        {pending ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : user.role === 'admin' ? (
                          <ShieldOff size={13} />
                        ) : (
                          <Shield size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(user.id)}
                        disabled={pending}
                        title="移除成员"
                        className="grid h-7 w-7 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-danger-400 disabled:opacity-50"
                      >
                        <UserMinus size={14} />
                      </button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-600">
          已移除 — {removed.length}
        </h4>
        {loadingRemoved ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-mist-600">
            <LoaderCircle size={13} className="animate-spin" />
            正在加载…
          </div>
        ) : removed.length === 0 ? (
          <p className="px-2 text-[11px] leading-5 text-mist-600">
            没有被移除的成员。移除后可以在这里恢复。
          </p>
        ) : (
          <div className="space-y-1">
            {removed.map((user) => {
              const pending = pendingId === user.id;
              return (
                <div
                  key={user.id}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-2 opacity-70 transition hover:bg-white/[0.03] hover:opacity-100"
                >
                  <Avatar user={user} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-mist-300">
                      {user.display_name}
                    </p>
                    <p className="truncate text-[10px] text-mist-600">@{user.username}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestore(user)}
                    disabled={pending}
                    className="flex h-7 items-center gap-1 rounded-lg border border-mint-400/20 bg-mint-400/10 px-2.5 text-[11px] text-mint-400 transition hover:bg-mint-400/15 disabled:opacity-60"
                  >
                    {pending ? (
                      <LoaderCircle size={11} className="animate-spin" />
                    ) : (
                      <RotateCcw size={11} />
                    )}
                    恢复
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
