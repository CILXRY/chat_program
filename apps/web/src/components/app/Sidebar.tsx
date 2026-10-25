import {
  ChevronDown,
  Hash,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Volume2,
  X,
} from 'lucide-react';
import { useChatStore } from '../../lib/store';
import type { ChannelType } from '../../lib/types';
import { voiceClient } from '../../lib/rtc';
import Avatar from './Avatar';
import BrandGlyph from './BrandGlyph';

interface Props {
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectChannel: (id: number) => void;
  onCreateChannel: (type: ChannelType) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}

const connectionMeta = {
  online: { label: '已连接', dot: 'bg-mint-400', text: 'text-mint-400' },
  connecting: { label: '连接中…', dot: 'bg-warn-400 animate-pulse', text: 'text-warn-400' },
  offline: { label: '已断开，重连中', dot: 'bg-danger-400 animate-pulse', text: 'text-danger-400' },
} as const;

export default function Sidebar({
  mobileOpen,
  onCloseMobile,
  onSelectChannel,
  onCreateChannel,
  onOpenSettings,
  onLogout,
}: Props) {
  const me = useChatStore((state) => state.me);
  const channels = useChatStore((state) => state.channels);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const voice = useChatStore((state) => state.voice);
  const connection = useChatStore((state) => state.connection);
  const online = useChatStore((state) => state.online);

  if (!me) return null;

  const textChannels = channels.filter((channel) => channel.type === 'text');
  const voiceChannels = channels.filter((channel) => channel.type === 'voice');
  const voiceChannel = channels.find((channel) => channel.id === voice.channelId);
  const connectionInfo = connectionMeta[connection];

  return (
    <aside
      className={`${
        mobileOpen ? 'flex' : 'hidden'
      } fixed inset-y-0 left-0 z-50 h-dvh shrink-0 md:static md:z-auto md:flex`}
    >
      <div className="hidden w-[72px] shrink-0 flex-col items-center gap-3 border-r border-white/5 bg-base-950 py-4 lg:flex">
        <BrandGlyph size={38} />

        <div className="my-1 h-px w-8 bg-white/5" />

        <div className="relative flex flex-col items-center">
          <span className="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent-400" />
          <button
            type="button"
            title="Nebula 空间"
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-base-800 to-base-850 text-sm font-semibold text-mist-100 shadow-lg transition hover:border-accent-500/40"
            onClick={() => {
              const first = textChannels[0] ?? channels[0];
              if (first) onSelectChannel(first.id);
            }}
          >
            N
          </button>
        </div>

        <div className="mt-auto flex flex-col items-center gap-3">
          <span className="text-[10px] font-medium text-mist-600">
            {online.length} 在线
          </span>
          <span
            className={`h-2 w-2 rounded-full ${connectionInfo.dot}`}
            title={connectionInfo.label}
          />
        </div>
      </div>

      <div className="flex w-[280px] flex-col border-r border-white/5 bg-base-900 md:w-[264px]">
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-white/5 px-4">
          <span className="lg:hidden">
            <BrandGlyph size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate text-sm font-semibold tracking-tight">Nebula</p>
              <ChevronDown size={13} className="text-mist-600" />
            </div>
            <p className="text-[10px] text-mist-500">私人空间 · self-hosted</p>
          </div>
          <button
            type="button"
            onClick={onCloseMobile}
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200 md:hidden"
            aria-label="关闭频道列表"
          >
            <X size={17} />
          </button>
        </div>

        <div className="thin-scrollbar flex-1 overflow-y-auto px-2 py-4">
          <section>
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-mist-600">
                文字频道
              </span>
              <button
                type="button"
                onClick={() => onCreateChannel('text')}
                className="grid h-6 w-6 place-items-center rounded-md text-mist-600 transition hover:bg-white/5 hover:text-mist-300"
                aria-label="创建文字频道"
                title="创建文字频道"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {textChannels.map((channel) => {
                const active = channel.id === activeChannelId;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => onSelectChannel(channel.id)}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active
                        ? 'bg-white/[0.07] text-mist-50'
                        : 'text-mist-400 hover:bg-white/[0.035] hover:text-mist-200'
                    }`}
                    title={`#${channel.name}`}
                  >
                    <Hash
                      size={17}
                      className={active ? 'text-accent-300' : 'text-mist-600'}
                    />
                    <span className="truncate">{channel.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-7">
            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-mist-600">
                语音频道
              </span>
              <button
                type="button"
                onClick={() => onCreateChannel('voice')}
                className="grid h-6 w-6 place-items-center rounded-md text-mist-600 transition hover:bg-white/5 hover:text-mist-300"
                aria-label="创建语音频道"
                title="创建语音频道"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {voiceChannels.map((channel) => {
                const active = channel.id === activeChannelId;
                const connected = voice.channelId === channel.id;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => onSelectChannel(channel.id)}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active
                        ? 'bg-white/[0.07] text-mist-50'
                        : 'text-mist-400 hover:bg-white/[0.035] hover:text-mist-200'
                    }`}
                    title={channel.name}
                  >
                    <Volume2
                      size={17}
                      className={active || connected ? 'text-mint-400' : 'text-mist-600'}
                    />
                    <span className="truncate">{channel.name}</span>
                    {connected && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-mint-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-400" />
                        {voice.participants.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mt-8 rounded-xl border border-white/[0.05] bg-base-850/60 p-3">
            <p className="text-[11px] leading-5 text-mist-500">
              <span className="font-medium text-mist-300">小提示</span>
              <br />
              在语音频道里点「共享屏幕」，朋友就能实时看到你的画面。
            </p>
          </div>
        </div>

        {voice.channelId !== null && voiceChannel && (
          <div className="animate-fade-in mx-2 mb-2 rounded-xl border border-mint-400/20 bg-[#0c1a18] p-3 voice-glow">
            <div className="flex items-center justify-between">
              <span
                className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
                  voice.status === 'connecting' ? 'text-warn-400' : 'text-mint-400'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 animate-pulse rounded-full ${
                    voice.status === 'connecting' ? 'bg-warn-400' : 'bg-mint-400'
                  }`}
                />
                {voice.status === 'connecting' ? '正在连接…' : '语音已连接'}
              </span>
              <span className="text-[10px] text-mist-500">
                {voice.participants.length} 人
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectChannel(voice.channelId as number)}
              className="mt-1.5 flex w-full items-center gap-1.5 truncate text-left text-sm font-medium text-mist-100 hover:text-white"
            >
              <Volume2 size={15} className="shrink-0 text-mint-400" />
              <span className="truncate">{voiceChannel.name}</span>
            </button>

            <div className="mt-2.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => void voiceClient.toggleMute()}
                title={voice.muted ? '取消静音' : '静音'}
                className={`grid h-8 flex-1 place-items-center rounded-lg border text-xs transition ${
                  voice.muted
                    ? 'border-danger-400/25 bg-danger-400/10 text-danger-400 hover:bg-danger-400/15'
                    : 'border-white/[0.06] bg-white/[0.03] text-mist-300 hover:bg-white/[0.07]'
                }`}
              >
                {voice.muted ? <MicOff size={15} /> : <Mic size={15} />}
              </button>
              <button
                type="button"
                onClick={() => void voiceClient.toggleShare()}
                title={voice.sharing ? '停止共享' : '共享屏幕'}
                className={`grid h-8 flex-1 place-items-center rounded-lg border text-xs transition ${
                  voice.sharing
                    ? 'border-accent-500/30 bg-accent-500/15 text-accent-300'
                    : 'border-white/[0.06] bg-white/[0.03] text-mist-300 hover:bg-white/[0.07]'
                }`}
              >
                {voice.sharing ? <ScreenShareOff size={15} /> : <ScreenShare size={15} />}
              </button>
              <button
                type="button"
                onClick={() => voiceClient.leave()}
                title="离开语音"
                className="grid h-8 flex-1 place-items-center rounded-lg border border-danger-400/20 bg-danger-400/10 text-danger-400 transition hover:bg-danger-400/15"
              >
                <PhoneOff size={15} />
              </button>
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2.5 border-t border-white/5 bg-base-950/40 p-3">
          <Avatar user={me} size={34} online={connection === 'online'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-mist-100">{me.display_name}</p>
            <p
              className={`flex items-center gap-1 text-[10px] ${connectionInfo.text}`}
              title={connectionInfo.label}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connectionInfo.dot}`} />
              {connectionInfo.label}
              {me.role === 'admin' && (
                <span className="ml-auto rounded-full bg-accent-500/10 px-1.5 py-px text-[9px] text-accent-300">
                  管理员
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200"
            aria-label="设置"
            title="设置"
          >
            <Settings size={16} />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-danger-400"
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
