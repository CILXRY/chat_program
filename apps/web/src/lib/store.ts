import { create } from 'zustand';
import type {
  Channel,
  ConnectionStatus,
  Message,
  Toast,
  ToastKind,
  TypingUser,
  User,
  VoiceState,
} from './types';

export const emptyVoice: VoiceState = {
  channelId: null,
  status: 'idle',
  muted: false,
  sharing: false,
  participants: [],
  remoteStreams: {},
  localScreen: null,
  localAudio: null,
  screenHdr: false,
  screenNative: false,
};

interface InitPayload {
  me: User;
  channels: Channel[];
  users: User[];
  activeChannelId: number;
  initialMessages: Message[];
  initialHasMore: boolean;
}

interface ChatStore {
  me: User | null;
  channels: Channel[];
  users: User[];
  activeChannelId: number | null;
  messages: Record<number, Message[]>;
  messageStatus: Record<number, 'idle' | 'loading' | 'ready'>;
  hasMore: Record<number, boolean>;
  online: number[];
  typing: Record<number, TypingUser[]>;
  connection: ConnectionStatus;
  voice: VoiceState;
  toast: Toast | null;

  init: (payload: InitPayload) => void;
  setConnection: (status: ConnectionStatus) => void;
  setOnline: (ids: number[]) => void;
  setUserOnline: (id: number, online: boolean) => void;
  setChannels: (channels: Channel[]) => void;
  setUsers: (users: User[]) => void;
  upsertUser: (user: User) => void;
  replaceMe: (user: User) => void;
  removeUser: (id: number) => void;
  addChannel: (channel: Channel) => void;
  updateChannel: (channel: Channel) => void;
  removeChannel: (id: number) => void;
  setActiveChannel: (id: number) => void;
  setMessageStatus: (channelId: number, status: 'idle' | 'loading' | 'ready') => void;
  setMessages: (channelId: number, messages: Message[], hasMore: boolean) => void;
  prependMessages: (channelId: number, messages: Message[], hasMore: boolean) => void;
  mergeLatest: (channelId: number, messages: Message[]) => void;
  addOptimistic: (message: Message) => void;
  receiveMessage: (channelId: number, message: Message, nonce?: string | null) => void;
  failMessage: (channelId: number, nonce: string) => void;
  removeMessage: (channelId: number, messageId: number) => void;
  registerTyping: (channelId: number, user: { id: number; display_name: string }) => void;
  setVoice: (patch: Partial<VoiceState>) => void;
  clearVoice: () => void;
  showToast: (message: string, kind?: ToastKind) => void;
  clearToast: () => void;
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    if (a.id < 0 && b.id < 0) return b.id - a.id;
    if (a.id < 0) return 1;
    if (b.id < 0) return -1;
    return a.id - b.id;
  });
}

export const useChatStore = create<ChatStore>((set) => ({
  me: null,
  channels: [],
  users: [],
  activeChannelId: null,
  messages: {},
  messageStatus: {},
  hasMore: {},
  online: [],
  typing: {},
  connection: 'connecting',
  voice: emptyVoice,
  toast: null,

  init: ({ me, channels, users, activeChannelId, initialMessages, initialHasMore }) =>
    set({
      me,
      channels,
      users,
      activeChannelId,
      messages: { [activeChannelId]: initialMessages },
      messageStatus: { [activeChannelId]: 'ready' },
      hasMore: { [activeChannelId]: initialHasMore },
      online: [],
      typing: {},
      connection: 'connecting',
      voice: emptyVoice,
    }),

  setConnection: (connection) => set({ connection }),

  setOnline: (online) => set({ online: [...new Set(online)] }),

  setUserOnline: (id, online) =>
    set((state) => {
      const next = new Set(state.online);
      if (online) next.add(id);
      else next.delete(id);
      return { online: [...next] };
    }),

  setChannels: (channels) =>
    set((state) => ({
      channels,
      activeChannelId: channels.some((channel) => channel.id === state.activeChannelId)
        ? state.activeChannelId
        : (channels[0]?.id ?? null),
    })),

  setUsers: (users) => set({ users }),

  upsertUser: (user) =>
    set((state) => {
      const exists = state.users.some((item) => item.id === user.id);
      return {
        users: exists
          ? state.users.map((item) => (item.id === user.id ? user : item))
          : [...state.users, user],
      };
    }),

  addChannel: (channel) =>
    set((state) => {
      if (state.channels.some((item) => item.id === channel.id)) return state;
      return { channels: sortChannels([...state.channels, channel]) };
    }),

  updateChannel: (channel) =>
    set((state) => ({
      channels: sortChannels(
        state.channels.map((item) => (item.id === channel.id ? channel : item)),
      ),
    })),

  removeChannel: (id) =>
    set((state) => {
      const channels = state.channels.filter((channel) => channel.id !== id);
      const activeChannelId =
        state.activeChannelId === id
          ? (channels[0]?.id ?? null)
          : state.activeChannelId;
      return { channels, activeChannelId };
    }),

  replaceMe: (user) =>
    set((state) => ({
      me: user,
      users: state.users.map((item) => (item.id === user.id ? user : item)),
    })),

  removeUser: (id) =>
    set((state) => ({
      users: state.users.filter((user) => user.id !== id),
      online: state.online.filter((userId) => userId !== id),
    })),

  setActiveChannel: (id) => set({ activeChannelId: id }),

  setMessageStatus: (channelId, status) =>
    set((state) => ({
      messageStatus: { ...state.messageStatus, [channelId]: status },
    })),

  setMessages: (channelId, messages, hasMore) =>
    set((state) => ({
      messages: { ...state.messages, [channelId]: messages },
      hasMore: { ...state.hasMore, [channelId]: hasMore },
      messageStatus: { ...state.messageStatus, [channelId]: 'ready' },
    })),

  prependMessages: (channelId, messages, hasMore) =>
    set((state) => {
      const existing = state.messages[channelId] ?? [];
      const known = new Set(existing.map((message) => message.id));
      const older = messages.filter((message) => !known.has(message.id));
      return {
        messages: { ...state.messages, [channelId]: [...older, ...existing] },
        hasMore: { ...state.hasMore, [channelId]: hasMore },
      };
    }),

  mergeLatest: (channelId, messages) =>
    set((state) => {
      const merged = new Map<number, Message>();
      for (const message of state.messages[channelId] ?? []) {
        merged.set(message.id, message);
      }
      for (const message of messages) {
        merged.set(message.id, message);
      }
      return {
        messages: {
          ...state.messages,
          [channelId]: sortMessages([...merged.values()]),
        },
      };
    }),

  addOptimistic: (message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channel_id]: [...(state.messages[message.channel_id] ?? []), message],
      },
    })),

  receiveMessage: (channelId, message, nonce) =>
    set((state) => {
      const current = state.messages[channelId] ?? [];
      const withoutTemp = nonce
        ? current.filter((item) => !(item.pending && item.nonce === nonce))
        : current;
      let next = withoutTemp.map((item) => (item.id === message.id ? message : item));
      if (!next.some((item) => item.id === message.id)) {
        next = [...next, message];
      }
      return {
        messages: { ...state.messages, [channelId]: next },
        typing: {
          ...state.typing,
          [channelId]: (state.typing[channelId] ?? []).filter(
            (item) => item.id !== message.author.id,
          ),
        },
      };
    }),

  failMessage: (channelId, nonce) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).map((message) =>
          message.nonce === nonce ? { ...message, pending: false, failed: true } : message,
        ),
      },
    })),

  removeMessage: (channelId, messageId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: (state.messages[channelId] ?? []).filter(
          (message) => message.id !== messageId,
        ),
      },
    })),

  registerTyping: (channelId, user) =>
    set((state) => {
      const now = Date.now();
      const current = (state.typing[channelId] ?? []).filter(
        (item) => item.expiresAt > now && item.id !== user.id,
      );
      current.push({
        id: user.id,
        display_name: user.display_name,
        expiresAt: now + 5000,
      });
      return {
        typing: { ...state.typing, [channelId]: current.slice(-5) },
      };
    }),

  setVoice: (patch) => set((state) => ({ voice: { ...state.voice, ...patch } })),

  clearVoice: () => set({ voice: emptyVoice }),

  showToast: (message, kind = 'error') =>
    set({ toast: { id: Date.now(), message, kind } }),

  clearToast: () => set({ toast: null }),
}));

function sortChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => a.position - b.position || a.id - b.id);
}
