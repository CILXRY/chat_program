import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { notifyDesktop, onDesktopShortcut } from '../../lib/desktop';
import { getPrefs } from '../../lib/prefs';
import { voiceClient } from '../../lib/rtc';
import { useChatStore } from '../../lib/store';
import type {
  Channel,
  ChannelType,
  Message,
  ServerEvent,
  User,
} from '../../lib/types';
import { chatSocket } from '../../lib/ws';
import BrandGlyph from './BrandGlyph';
import ChatView from './ChatView';
import CreateChannelModal from './CreateChannelModal';
import MemberList from './MemberList';
import Sidebar from './Sidebar';
import SettingsModal from './settings/SettingsModal';
import Toast from './Toast';
import VoiceStage from './VoiceStage';

interface Props {
  me: User;
  initialChannels: Channel[];
  initialUsers: User[];
  activeChannelId: number;
  initialMessages: Message[];
  initialHasMore: boolean;
}

async function ensureMessages(channelId: number): Promise<void> {
  const state = useChatStore.getState();
  const status = state.messageStatus[channelId];
  if (status === 'loading' || status === 'ready') return;

  state.setMessageStatus(channelId, 'loading');
  try {
    const page = await api.getMessages(channelId);
    useChatStore.getState().setMessages(channelId, page.items, page.has_more);
  } catch {
    useChatStore.getState().setMessageStatus(channelId, 'idle');
    useChatStore.getState().showToast('加载消息失败，请稍后再试', 'error');
  }
}

type ChatState = ReturnType<typeof useChatStore.getState>;
type VoiceStateEvent = Extract<ServerEvent, { type: 'voice.state' }>;

function notifyShareChanges(state: ChatState, event: VoiceStateEvent): void {
  if (!getPrefs().desktopNotifications) return;
  if (state.voice.channelId !== event.channel_id) return;
  if (state.voice.participants.length === 0) return;

  const previous = new Map(
    state.voice.participants.map((participant) => [
      participant.user_id,
      participant.sharing,
    ]),
  );
  const channel = state.channels.find((item) => item.id === event.channel_id);

  for (const participant of event.participants) {
    if (participant.user_id === state.me?.id) continue;
    const before = previous.get(participant.user_id);
    if (before === undefined || before === participant.sharing) continue;

    const user = state.users.find((item) => item.id === participant.user_id);
    const name = user?.display_name ?? '有人';
    notifyDesktop(
      participant.sharing ? `${name} 开始共享屏幕` : `${name} 停止共享屏幕`,
      channel ? `#${channel.name}` : 'Nebula 语音频道',
    );
  }
}

async function resync(): Promise<void> {
  const state = useChatStore.getState();
  const current = state.channels.find((channel) => channel.id === state.activeChannelId);
  const jobs: Promise<unknown>[] = [
    api
      .getChannels()
      .then((channels) => useChatStore.getState().setChannels(channels))
      .catch(() => undefined),
    api
      .getUsers()
      .then((users) => useChatStore.getState().setUsers(users))
      .catch(() => undefined),
  ];

  if (current?.type === 'text') {
    jobs.push(
      api
        .getMessages(current.id)
        .then((page) => useChatStore.getState().mergeLatest(current.id, page.items))
        .catch(() => undefined),
    );
  }

  await Promise.all(jobs);
}

export default function App(props: Props) {
  useState(() => {
    useChatStore.getState().init({
      me: props.me,
      channels: props.initialChannels,
      users: props.initialUsers,
      activeChannelId: props.activeChannelId,
      initialMessages: props.initialMessages,
      initialHasMore: props.initialHasMore,
    });
  });

  const me = useChatStore((state) => state.me);
  const channels = useChatStore((state) => state.channels);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const activeChannel = channels.find((channel) => channel.id === activeChannelId);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(
    () => window.matchMedia('(min-width: 1280px)').matches,
  );
  const [createType, setCreateType] = useState<ChannelType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const unsubscribeEvent = chatSocket.onEvent((event: ServerEvent) => {
      const store = useChatStore.getState();
      switch (event.type) {
        case 'ready':
          store.setOnline(event.online_user_ids);
          break;
        case 'presence.update':
          store.setUserOnline(event.user_id, event.online);
          break;
        case 'message.created':
          store.receiveMessage(event.message.channel_id, event.message, event.nonce);
          break;
        case 'message.deleted':
          store.removeMessage(event.channel_id, event.message_id);
          break;
        case 'typing.start':
          store.registerTyping(event.channel_id, event.user);
          break;
        case 'channel.created':
          store.addChannel(event.channel);
          break;
        case 'channel.updated':
          store.updateChannel(event.channel);
          break;
        case 'channel.deleted':
          if (store.voice.channelId === event.channel_id) {
            voiceClient.leave();
          }
          store.removeChannel(event.channel_id);
          break;
        case 'user.created':
          store.upsertUser(event.user);
          break;
        case 'user.updated':
          if (store.me?.id === event.user.id) {
            store.replaceMe(event.user);
          } else {
            store.upsertUser(event.user);
          }
          break;
        case 'member.removed':
          store.removeUser(event.user_id);
          if (event.user_id === store.me?.id) {
            window.location.assign('/login');
          } else {
            store.showToast('一名成员已被管理员移除', 'info');
          }
          break;
        case 'member.restored':
          store.upsertUser(event.user);
          break;
        case 'voice.state':
          notifyShareChanges(store, event);
          voiceClient.handleEvent(event);
          break;
        case 'rtc.offer':
        case 'rtc.answer':
        case 'rtc.ice':
          voiceClient.handleEvent(event);
          break;
        case 'error':
          store.showToast(event.message, 'error');
          break;
        default:
          break;
      }
    });

    const unsubscribeStatus = chatSocket.onStatus((status) => {
      const store = useChatStore.getState();
      if (status === 'open') {
        store.setConnection('online');
        const current = store.activeChannelId;
        if (current !== null) {
          chatSocket.send({ type: 'subscribe', channel_id: current });
        }
        void resync();
      } else if (status === 'connecting') {
        store.setConnection('connecting');
      } else {
        store.setConnection('offline');
        voiceClient.handleSocketDown();
      }
    });

    chatSocket.connect();

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      chatSocket.disconnect();
      voiceClient.dispose();
      useChatStore.getState().clearVoice();
    };
  }, []);

  useEffect(() => {
    return onDesktopShortcut((action) => {
      if (action === 'toggle-mute') {
        void voiceClient.toggleMute();
      } else if (action === 'leave-voice') {
        voiceClient.leave();
      }
    });
  }, []);

  useEffect(() => {
    function handlePopState() {
      const match = window.location.pathname.match(/^\/channels\/(\d+)\/?$/);
      if (!match) return;
      const channelId = Number(match[1]);
      if (channels.some((channel) => channel.id === channelId)) {
        useChatStore.getState().setActiveChannel(channelId);
      }
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [channels]);

  useEffect(() => {
    if (activeChannelId === null) return;
    const path = `/channels/${activeChannelId}`;
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path);
    }
  }, [activeChannelId]);

  useEffect(() => {
    if (!activeChannel) return;
    const channelId = activeChannel.id;
    if (chatSocket.connected) {
      chatSocket.send({ type: 'subscribe', channel_id: channelId });
    }
    if (activeChannel.type === 'text') {
      void ensureMessages(channelId);
    }
    return () => {
      if (chatSocket.connected) {
        chatSocket.send({ type: 'unsubscribe', channel_id: channelId });
      }
    };
  }, [activeChannel?.id, activeChannel?.type]);

  function selectChannel(id: number) {
    const state = useChatStore.getState();
    const channel = state.channels.find((item) => item.id === id);
    if (!channel) return;
    if (state.activeChannelId !== id) {
      state.setActiveChannel(id);
      window.history.pushState({}, '', `/channels/${id}`);
    }
    setSidebarOpen(false);
  }

  function openSidebar() {
    setSidebarOpen(true);
    setMembersOpen(false);
  }

  function toggleMembers() {
    setMembersOpen((open) => !open);
    setSidebarOpen(false);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // The cookie may already be gone; still send the user to the login page.
    }
    window.location.assign('/login');
  }

  if (!me) {
    return (
      <div className="grid h-dvh place-items-center bg-base-950">
        <BrandGlyph size={48} />
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-dvh overflow-hidden bg-base-950">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭频道列表"
        />
      )}

      <Sidebar
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        onSelectChannel={selectChannel}
        onCreateChannel={(type) => setCreateType(type)}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={() => void logout()}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {activeChannel ? (
          activeChannel.type === 'text' ? (
            <ChatView
              key={activeChannel.id}
              channel={activeChannel}
              onOpenSidebar={openSidebar}
              onOpenMembers={toggleMembers}
            />
          ) : (
            <VoiceStage
              key={activeChannel.id}
              channel={activeChannel}
              onOpenSidebar={openSidebar}
              onOpenMembers={toggleMembers}
            />
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-mist-500">
            <BrandGlyph size={56} />
            <p className="text-sm">选择一个频道开始聊天</p>
          </div>
        )}
      </main>

      {membersOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/55 backdrop-blur-sm xl:hidden"
          onClick={() => setMembersOpen(false)}
          aria-label="关闭成员列表"
        />
      )}

      <MemberList open={membersOpen} onClose={() => setMembersOpen(false)} />

      {createType !== null && (
        <CreateChannelModal
          defaultType={createType}
          onClose={() => setCreateType(null)}
          onCreated={(channel) => selectChannel(channel.id)}
        />
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      <Toast />
    </div>
  );
}
