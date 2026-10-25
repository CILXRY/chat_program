import { LoaderCircle, MicOff, ScreenShare, Shield, UserMinus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useChatStore } from '../../lib/store';
import type { User, VoiceState } from '../../lib/types';
import Avatar from './Avatar';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MemberList({ open, onClose }: Props) {
  const users = useChatStore((state) => state.users);
  const online = useChatStore((state) => state.online);
  const voice = useChatStore((state) => state.voice);
  const me = useChatStore((state) => state.me);

  const onlineSet = new Set(online);
  const sorted = [...users].sort((a, b) => {
    const aOnline = onlineSet.has(a.id) ? 1 : 0;
    const bOnline = onlineSet.has(b.id) ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return a.display_name.localeCompare(b.display_name, 'zh-CN');
  });

  const onlineUsers = sorted.filter((user) => onlineSet.has(user.id));
  const offlineUsers = sorted.filter((user) => !onlineSet.has(user.id));

  return (
    <aside
      className={`${
        open ? 'flex' : 'hidden'
      } fixed inset-y-0 right-0 z-40 w-[280px] shrink-0 flex-col border-l border-white/5 bg-base-900 xl:static xl:z-auto xl:w-[248px]`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-mist-500" />
          <h2 className="text-sm font-semibold text-mist-200">成员</h2>
          <span className="rounded-full bg-base-800 px-1.5 py-0.5 text-[10px] text-mist-500">
            {onlineUsers.length}/{users.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200"
          aria-label="关闭成员列表"
        >
          <X size={16} />
        </button>
      </div>

      <div className="thin-scrollbar flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <Group
          label="在线"
          users={onlineUsers}
          onlineSet={onlineSet}
          voice={voice}
          me={me}
          empty="暂时没有其他人在线"
        />
        {offlineUsers.length > 0 && (
          <Group
            label="离线"
            users={offlineUsers}
            onlineSet={onlineSet}
            voice={voice}
            me={me}
            empty=""
            muted
          />
        )}
      </div>

      <div className="border-t border-white/5 px-4 py-3">
        <p className="text-[10px] leading-4 text-mist-600">
          WebRTC 直连 · 最多 5 人语音
          <br />
          公网使用建议配置 TURN 服务
        </p>
      </div>
    </aside>
  );
}

function Group({
  label,
  users,
  onlineSet,
  voice,
  me,
  empty,
  muted = false,
}: {
  label: string;
  users: User[];
  onlineSet: Set<number>;
  voice: VoiceState;
  me: User | null;
  empty: string;
  muted?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-600">
        {label} — {users.length}
      </h3>
      {users.length === 0 && empty ? (
        <p className="px-1 text-[11px] leading-5 text-mist-600">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {users.map((user) => (
            <MemberRow
              key={user.id}
              user={user}
              online={onlineSet.has(user.id)}
              voice={voice}
              me={me}
              muted={muted}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MemberRow({
  user,
  online,
  voice,
  me,
  muted,
}: {
  user: User;
  online: boolean;
  voice: VoiceState;
  me: User | null;
  muted: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const isSelf = user.id === me?.id;
  const canModerate = me?.role === 'admin' && !isSelf;
  const voiceState =
    voice.channelId !== null
      ? voice.participants.find((participant) => participant.user_id === user.id)
      : undefined;

  async function handleRemove() {
    if (pending) return;
    setPending(true);
    try {
      await api.removeMember(user.id);
      useChatStore.getState().removeUser(user.id);
      useChatStore.getState().showToast(`已移除 ${user.display_name}`, 'info');
    } catch {
      useChatStore.getState().showToast('移除成员失败，请稍后再试', 'error');
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-white/[0.035] ${
          muted ? 'opacity-55' : ''
        }`}
      >
        <Avatar user={user} size={30} online={online} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[13px] font-medium text-mist-200">
            <span className="truncate">{user.display_name}</span>
            {user.role === 'admin' && (
              <Shield
                size={11}
                className="shrink-0 text-accent-300"
                aria-label="管理员"
              />
            )}
            {isSelf && (
              <span className="shrink-0 text-[10px] font-normal text-mist-600">你</span>
            )}
          </p>
          <p className="truncate text-[10px] text-mist-600">@{user.username}</p>
        </div>
        {voiceState?.sharing && (
          <ScreenShare size={13} className="shrink-0 text-accent-300" aria-label="正在共享屏幕" />
        )}
        {voiceState?.muted && (
          <MicOff size={13} className="shrink-0 text-mist-500" aria-label="已静音" />
        )}
        {canModerate && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-mist-600 opacity-0 transition hover:bg-white/5 hover:text-danger-400 group-hover:opacity-100"
            aria-label={`移除 ${user.display_name}`}
            title="移除成员"
          >
            <UserMinus size={13} />
          </button>
        )}
      </div>

      {confirming && (
        <div className="mb-1 ml-9 flex items-center gap-1.5 rounded-lg border border-danger-400/20 bg-danger-400/[0.06] px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[10px] text-danger-400">
            移除 {user.display_name}？
          </span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={pending}
            className="flex h-6 items-center gap-1 rounded-md bg-danger-400/90 px-2 text-[10px] font-medium text-white transition hover:bg-danger-400 disabled:opacity-60"
          >
            {pending && <LoaderCircle size={10} className="animate-spin" />}
            确认
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="h-6 rounded-md px-1.5 text-[10px] text-mist-400 transition hover:text-mist-200"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}
