import {
  LoaderCircle,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  ShieldCheck,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { voiceClient } from '../../lib/rtc';
import { useChatStore } from '../../lib/store';
import type { Channel, VoiceParticipant } from '../../lib/types';
import Avatar from './Avatar';

interface Props {
  channel: Channel;
  onOpenSidebar: () => void;
  onOpenMembers: () => void;
}

function StreamVideo({
  stream,
  muted = false,
  className = '',
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    if (stream) {
      void video.play().catch(() => undefined);
    }
  }, [stream]);

  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

export default function VoiceStage({ channel, onOpenSidebar, onOpenMembers }: Props) {
  const voice = useChatStore((state) => state.voice);
  const users = useChatStore((state) => state.users);
  const me = useChatStore((state) => state.me);
  const online = useChatStore((state) => state.online);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const inThisChannel = voice.channelId === channel.id;
  const isConnecting = inThisChannel && voice.status === 'connecting';

  useEffect(() => {
    setExpanded(null);
  }, [channel.id]);

  const meUser = me;
  const participants = voice.participants;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      useChatStore.getState().showToast('复制链接失败，请手动复制地址栏', 'error');
    }
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-base-900/40">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/5 bg-base-900/30 px-3 backdrop-blur sm:px-5">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="grid h-9 w-9 place-items-center rounded-lg text-mist-400 transition hover:bg-white/5 hover:text-mist-100 md:hidden"
          aria-label="打开频道列表"
        >
          <Menu size={19} />
        </button>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mint-400/10 text-mint-400">
          <Volume2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-[15px] font-semibold tracking-tight text-mist-100">
            {channel.name}
            {inThisChannel && (
              <span
                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                  isConnecting
                    ? 'border-warn-400/20 bg-warn-400/10 text-warn-400'
                    : 'border-mint-400/20 bg-mint-400/10 text-mint-400'
                }`}
              >
                <span
                  className={`h-1 w-1 rounded-full ${
                    isConnecting ? 'animate-pulse bg-warn-400' : 'bg-mint-400'
                  }`}
                />
                {isConnecting ? '连接中' : '已连接'}
              </span>
            )}
          </h1>
          <p className="truncate text-[11px] text-mist-500">
            {channel.topic ?? '语音频道'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-white/5 bg-base-850 px-2.5 py-1 text-[11px] text-mist-400 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
            {online.length} 在线
          </span>
          <button
            type="button"
            onClick={onOpenMembers}
            className="grid h-9 w-9 place-items-center rounded-lg text-mist-400 transition hover:bg-white/5 hover:text-mist-100"
            aria-label="成员列表"
            title="成员列表"
          >
            <Users size={18} />
          </button>
        </div>
      </header>

      {!inThisChannel ? (
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="aurora aurora-a left-1/4 top-10 opacity-20"></div>
          <div className="aurora aurora-b opacity-10"></div>
          <div className="relative w-full max-w-lg text-center">
            <div className="relative mx-auto mb-7 h-24 w-24">
              <span className="absolute inset-0 animate-ping rounded-[2rem] border border-mint-400/10"></span>
              <span className="absolute inset-2 rounded-[1.7rem] border border-mint-400/15"></span>
              <span className="relative grid h-24 w-24 place-items-center rounded-[2rem] border border-mint-400/25 bg-mint-400/10 text-mint-400 shadow-[0_0_60px_-15px_rgba(88,224,194,0.5)]">
                <Volume2 size={36} />
              </span>
            </div>

            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-mint-400">
              Voice channel
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{channel.name}</h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-mist-500">
              {channel.topic ?? '加入频道，和这里的人开麦聊聊。'}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-mist-400">
              <span className="flex items-center gap-1.5 rounded-full border border-white/5 bg-base-850 px-2.5 py-1">
                <Users size={12} />
                最多 5 人
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/5 bg-base-850 px-2.5 py-1">
                <ScreenShare size={12} />
                屏幕共享
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/5 bg-base-850 px-2.5 py-1">
                <ShieldCheck size={12} />
                P2P 直连
              </span>
            </div>

            <button
              type="button"
              disabled={isConnecting}
              onClick={() => void voiceClient.join(channel.id)}
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-mint-400 px-6 text-sm font-semibold text-[#062b25] shadow-[0_16px_40px_-16px_rgba(88,224,194,0.8)] transition hover:brightness-105 disabled:opacity-60"
            >
              {isConnecting ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  正在连接…
                </>
              ) : (
                <>
                  <Volume2 size={17} />
                  {voice.channelId !== null ? '切换到这个频道' : '加入语音频道'}
                </>
              )}
            </button>
            <p className="mt-3 text-[11px] text-mist-600">
              加入后浏览器会请求麦克风权限
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
            {isConnecting ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-mist-500">
                <LoaderCircle size={24} className="animate-spin text-mint-400" />
                <p className="text-sm">正在建立语音连接…</p>
                <p className="text-[11px] text-mist-600">如果浏览器询问权限，请选择允许</p>
              </div>
            ) : (
              <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {participants.map((participant) => {
                  const user = users.find((item) => item.id === participant.user_id);
                  const isSelf = participant.user_id === meUser?.id;
                  const stream = isSelf
                    ? voice.localScreen
                    : (voice.remoteStreams[participant.user_id] ?? null);
                  return (
                    <ParticipantTile
                      key={participant.user_id}
                      participant={participant}
                      name={user?.display_name ?? '未知用户'}
                      color={user?.avatar_color ?? '#8b7cff'}
                      isSelf={isSelf}
                      stream={stream}
                      onExpand={() => setExpanded(participant.user_id)}
                    />
                  );
                })}

                {participants.length <= 1 && (
                  <div className="col-span-full flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.08] bg-base-900/40 px-6 py-10 text-center">
                    <p className="text-sm text-mist-400">现在只有你在频道里</p>
                    <p className="max-w-sm text-[11px] leading-5 text-mist-600">
                      把频道链接发给朋友，或者从另一个浏览器登录 bob，一起测试屏幕共享。
                    </p>
                    <button
                      type="button"
                      onClick={() => void copyInvite()}
                      className="rounded-lg border border-white/[0.07] bg-base-850 px-3 py-1.5 text-[11px] text-mist-300 transition hover:border-white/15 hover:text-white"
                    >
                      {copied ? '已复制链接' : '复制频道链接'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/5 bg-base-900/60 px-3 py-3 backdrop-blur sm:px-5">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={`flex items-center gap-1.5 text-[11px] font-medium ${
                    isConnecting ? 'text-warn-400' : 'text-mint-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 animate-pulse rounded-full ${
                      isConnecting ? 'bg-warn-400' : 'bg-mint-400'
                    }`}
                  />
                  {isConnecting ? '正在连接…' : '语音已连接'}
                  <span className="text-mist-600">·</span>
                  <span className="font-normal text-mist-500">
                    {participants.length} 人
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-mist-400">#{channel.name}</p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void voiceClient.toggleMute()}
                  className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition ${
                    voice.muted
                      ? 'border-danger-400/25 bg-danger-400/10 text-danger-400 hover:bg-danger-400/15'
                      : 'border-white/[0.07] bg-base-850 text-mist-300 hover:bg-base-800 hover:text-white'
                  }`}
                  title={voice.muted ? '取消静音' : '静音'}
                >
                  {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}
                  <span className="hidden sm:inline">
                    {voice.muted ? '取消静音' : '静音'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void voiceClient.toggleShare()}
                  className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-medium transition ${
                    voice.sharing
                      ? 'border-accent-500/30 bg-accent-500/15 text-accent-300 hover:bg-accent-500/20'
                      : 'border-white/[0.07] bg-base-850 text-mist-300 hover:bg-base-800 hover:text-white'
                  }`}
                  title={voice.sharing ? '停止共享' : '共享屏幕'}
                >
                  {voice.sharing ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
                  <span className="hidden sm:inline">
                    {voice.sharing ? '停止共享' : '共享屏幕'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => voiceClient.leave()}
                  className="flex h-10 items-center gap-2 rounded-xl border border-danger-400/25 bg-danger-400/10 px-3 text-xs font-medium text-danger-400 transition hover:bg-danger-400/15"
                  title="离开语音频道"
                >
                  <PhoneOff size={16} />
                  <span className="hidden sm:inline">离开</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="hidden">
        {Object.entries(voice.remoteStreams).map(([userId, stream]) => (
          <audio
            key={userId}
            autoPlay
            playsInline
            ref={(element) => {
              if (element && element.srcObject !== stream) {
                element.srcObject = stream;
                void element.play().catch(() => undefined);
              }
            }}
          />
        ))}
      </div>

      {expanded !== null &&
        (() => {
          const participant = voice.participants.find((item) => item.user_id === expanded);
          if (!participant) return null;
          const user = users.find((item) => item.id === expanded);
          const isSelf = expanded === meUser?.id;
          const stream = isSelf
            ? voice.localScreen
            : (voice.remoteStreams[expanded] ?? null);
          return (
            <div className="animate-fade-in fixed inset-0 z-[75] flex flex-col bg-black/95 p-3 backdrop-blur sm:p-6">
              <div className="flex items-center justify-between gap-3 pb-3">
                <p className="flex items-center gap-2 text-sm font-medium text-mist-200">
                  <ScreenShare size={16} className="text-accent-300" />
                  {user?.display_name ?? '用户'} 的屏幕
                </p>
                <button
                  type="button"
                  onClick={() => setExpanded(null)}
                  className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-mist-300 transition hover:bg-white/10 hover:text-white"
                  aria-label="退出全屏"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <StreamVideo
                  stream={stream}
                  muted={isSelf}
                  className="max-h-full max-w-full rounded-xl bg-black object-contain shadow-2xl"
                />
              </div>
            </div>
          );
        })()}
    </section>
  );
}

function ParticipantTile({
  participant,
  name,
  color,
  isSelf,
  stream,
  onExpand,
}: {
  participant: VoiceParticipant;
  name: string;
  color: string;
  isSelf: boolean;
  stream: MediaStream | null;
  onExpand: () => void;
}) {
  const sharing = participant.sharing;

  return (
    <div
      className={`group relative aspect-video overflow-hidden rounded-2xl border bg-base-850 ${
        sharing ? 'border-accent-500/25' : 'border-white/[0.06]'
      }`}
    >
      {sharing && stream ? (
        <>
          <StreamVideo
            stream={stream}
            muted={isSelf}
            className="h-full w-full bg-black object-contain"
          />
          <button
            type="button"
            onClick={onExpand}
            className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-black/50 text-mist-300 opacity-0 backdrop-blur transition hover:bg-black/70 hover:text-white group-hover:opacity-100"
            aria-label="放大屏幕"
            title="放大"
          >
            <Maximize2 size={14} />
          </button>
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[9px] font-medium text-accent-300 backdrop-blur">
            <ScreenShare size={10} />
            正在共享
          </span>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_20%,rgba(139,124,255,0.12),transparent_65%)]">
          <Avatar
            user={{ display_name: name, avatar_color: color }}
            size={64}
            className="shadow-2xl"
          />
          {sharing && (
            <span className="flex items-center gap-1.5 text-[11px] text-mist-500">
              <LoaderCircle size={12} className="animate-spin" />
              正在接收画面…
            </span>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pb-2 pt-8">
        <span className="h-1.5 w-1.5 rounded-full bg-mint-400"></span>
        <span className="truncate text-[11px] font-medium text-mist-100">
          {name}
          {isSelf && <span className="ml-1 font-normal text-mist-400">（你）</span>}
        </span>
        {participant.muted && <MicOff size={12} className="shrink-0 text-mist-500" />}
        {sharing && <ScreenShare size={12} className="shrink-0 text-accent-300" />}
      </div>
    </div>
  );
}
