import { MicOff, ScreenShare, Users, X } from 'lucide-react';
import { useChatStore } from '../../lib/store';
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
          meId={me?.id}
          empty="暂时没有其他人在线"
        />
        {offlineUsers.length > 0 && (
          <Group
            label="离线"
            users={offlineUsers}
            onlineSet={onlineSet}
            voice={voice}
            meId={me?.id}
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
  meId,
  empty,
  muted = false,
}: {
  label: string;
  users: ReturnType<typeof useChatStore.getState>['users'];
  onlineSet: Set<number>;
  voice: ReturnType<typeof useChatStore.getState>['voice'];
  meId: number | undefined;
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
          {users.map((user) => {
            const online = onlineSet.has(user.id);
            const voiceState =
              voice.channelId !== null
                ? voice.participants.find((participant) => participant.user_id === user.id)
                : undefined;
            return (
              <div
                key={user.id}
                className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-white/[0.035] ${
                  muted ? 'opacity-55' : ''
                }`}
              >
                <Avatar user={user} size={30} online={online} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-mist-200">
                    {user.display_name}
                    {user.id === meId && (
                      <span className="ml-1 text-[10px] font-normal text-mist-600">你</span>
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
