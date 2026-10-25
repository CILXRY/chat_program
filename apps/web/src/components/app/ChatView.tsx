import {
  ChevronUp,
  CircleAlert,
  Hash,
  LoaderCircle,
  Menu,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { chatSocket } from '../../lib/ws';
import { useChatStore } from '../../lib/store';
import type { Channel, Message } from '../../lib/types';
import { useNow } from '../../hooks/useNow';
import Avatar from './Avatar';

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TYPING: { id: number; display_name: string; expiresAt: number }[] = [];

interface Props {
  channel: Channel;
  onOpenSidebar: () => void;
  onOpenMembers: () => void;
}

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
});

function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

function dateKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dateKey(iso) === dateKey(now.toISOString())) return '今天';
  if (dateKey(iso) === dateKey(yesterday.toISOString())) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return dayFormatter.format(date);
  return `${date.getFullYear()}年${dayFormatter.format(date)}`;
}

interface Row {
  message: Message;
  showHeader: boolean;
  day: string | null;
}

function buildRows(messages: Message[]): Row[] {
  return messages.map((message, index) => {
    const previous = messages[index - 1];
    const day =
      !previous || dateKey(previous.created_at) !== dateKey(message.created_at)
        ? formatDay(message.created_at)
        : null;
    const tooLong =
      previous &&
      new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() >
        5 * 60 * 1000;
    const showHeader =
      !previous || day !== null || previous.author.id !== message.author.id || Boolean(tooLong);
    return { message, showHeader, day };
  });
}

export default function ChatView({ channel, onOpenSidebar, onOpenMembers }: Props) {
  const me = useChatStore((state) => state.me);
  const messages = useChatStore((state) => state.messages[channel.id] ?? EMPTY_MESSAGES);
  const status = useChatStore((state) => state.messageStatus[channel.id]);
  const hasMore = useChatStore((state) => state.hasMore[channel.id] ?? false);
  const online = useChatStore((state) => state.online);
  const typing = useChatStore((state) => state.typing[channel.id] ?? EMPTY_TYPING);
  const now = useNow(1000);

  const [draft, setDraft] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTypingSent = useRef(0);

  const rows = useMemo(() => buildRows(messages), [messages]);
  const activeTyping = typing.filter((item) => item.expiresAt > now && item.id !== me?.id);

  useEffect(() => {
    setDraft('');
    stickToBottom.current = true;
  }, [channel.id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [channel.id, messages.length]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  async function loadOlder() {
    if (loadingOlder) return;
    const first = messages.find((message) => message.id > 0);
    if (!first) return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const page = await api.getMessages(channel.id, first.id);
      useChatStore.getState().prependMessages(channel.id, page.items, page.has_more);
      window.requestAnimationFrame(() => {
        if (!element) return;
        element.scrollTop = element.scrollHeight - previousHeight;
        stickToBottom.current = false;
      });
    } catch {
      useChatStore.getState().showToast('加载更早的消息失败', 'error');
    } finally {
      setLoadingOlder(false);
    }
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    const nowMs = Date.now();
    if (value.trim() && nowMs - lastTypingSent.current > 2200) {
      lastTypingSent.current = nowMs;
      chatSocket.send({ type: 'typing', channel_id: channel.id });
    }
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !me) return;

    const nonce =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: Message = {
      id: -Math.floor(Math.random() * 1_000_000_000_000),
      channel_id: channel.id,
      content,
      created_at: new Date().toISOString(),
      edited_at: null,
      author: me,
      nonce,
      pending: true,
    };

    setDraft('');
    stickToBottom.current = true;
    useChatStore.getState().addOptimistic(optimistic);

    try {
      const saved = await api.sendMessage(channel.id, content, nonce);
      useChatStore.getState().receiveMessage(channel.id, saved, nonce);
    } catch {
      useChatStore.getState().failMessage(channel.id, nonce);
      useChatStore.getState().showToast('消息发送失败，请检查网络后重试', 'error');
    }
  }

  async function handleDelete(message: Message) {
    if (!me || message.author.id !== me.id || message.id < 0) return;
    try {
      await api.deleteMessage(message.id);
      useChatStore.getState().removeMessage(channel.id, message.id);
    } catch {
      useChatStore.getState().showToast('删除消息失败', 'error');
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-base-900/40">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/5 bg-base-900/30 px-3 backdrop-blur sm:px-5">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="grid h-9 w-9 place-items-center rounded-lg text-mist-400 transition hover:bg-white/5 hover:text-mist-100 md:hidden"
          aria-label="打开频道列表"
        >
          <Menu size={19} />
        </button>

        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-base-800 text-mist-400">
          <Hash size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-mist-100">
            {channel.name}
          </h1>
          {channel.topic && (
            <p className="truncate text-[11px] text-mist-500">{channel.topic}</p>
          )}
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="thin-scrollbar min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-4xl px-3 py-6 sm:px-7">
          <div className="mb-7 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-base-850 to-base-900 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-500/10 text-accent-300">
                <Hash size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight">
                  欢迎来到 #{channel.name}
                </h2>
                <p className="mt-1 text-[13px] leading-6 text-mist-500">
                  {channel.topic ?? '这是这个频道的开始，发条消息打个招呼吧。'}
                </p>
              </div>
            </div>
          </div>

          {hasMore && (
            <div className="mb-5 flex justify-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-base-850 px-3.5 py-1.5 text-[11px] text-mist-400 transition hover:border-white/10 hover:text-mist-200 disabled:opacity-60"
              >
                {loadingOlder ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <ChevronUp size={13} />
                )}
                加载更早的消息
              </button>
            </div>
          )}

          {messages.length === 0 && status === 'loading' && (
            <div className="flex justify-center py-16 text-mist-600">
              <LoaderCircle size={22} className="animate-spin" />
            </div>
          )}

          {messages.length === 0 && status !== 'loading' && (
            <div className="py-12 text-center">
              <p className="text-sm text-mist-500">这里还很安静。</p>
              <p className="mt-1 text-xs text-mist-600">发送第一条消息，让频道热闹起来。</p>
            </div>
          )}

          <div className="space-y-0.5">
            {rows.map(({ message, showHeader, day }) => (
              <div key={message.id}>
                {day && (
                  <div className="my-6 flex items-center gap-3 text-[10px] text-mist-600">
                    <span className="h-px flex-1 bg-white/5" />
                    <span>{day}</span>
                    <span className="h-px flex-1 bg-white/5" />
                  </div>
                )}
                <article
                  className={`group relative flex gap-3 rounded-lg px-2 py-1 transition hover:bg-white/[0.022] ${
                    showHeader ? 'mt-3' : ''
                  } ${message.pending ? 'opacity-60' : ''}`}
                >
                  {showHeader ? (
                    <Avatar user={message.author} size={36} className="mt-0.5" />
                  ) : (
                    <div className="flex w-9 shrink-0 justify-center pt-1 text-[10px] text-transparent transition group-hover:text-mist-600">
                      {formatTime(message.created_at)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {showHeader && (
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span
                          className="text-[14px] font-semibold"
                          style={{ color: message.author.avatar_color }}
                        >
                          {message.author.display_name}
                        </span>
                        <time className="text-[10px] text-mist-600">
                          {formatTime(message.created_at)}
                        </time>
                        {message.pending && (
                          <span className="flex items-center gap-1 text-[10px] text-mist-600">
                            <LoaderCircle size={11} className="animate-spin" />
                            发送中
                          </span>
                        )}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.75] text-mist-200">
                      {message.content}
                    </p>
                    {message.failed && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-danger-400">
                        <CircleAlert size={12} />
                        发送失败
                      </p>
                    )}
                  </div>

                  {me && message.author.id === me.id && message.id > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(message)}
                      className="absolute right-2 top-1.5 grid h-7 w-7 place-items-center rounded-md bg-base-800 text-mist-500 opacity-0 shadow transition hover:text-danger-400 group-hover:opacity-100"
                      aria-label="删除消息"
                      title="删除消息"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </article>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-4 pt-1 sm:px-7">
        <div className="mx-auto h-5 max-w-4xl px-1 text-[11px] text-mist-500">
          {activeTyping.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="flex gap-0.5 pt-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-mint-400 [animation-delay:-0.3s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-mint-400 [animation-delay:-0.15s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-mint-400" />
              </span>
              {activeTyping.map((item) => item.display_name).join('、')} 正在输入…
            </span>
          ) : (
            <span className="opacity-0">.</span>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-white/[0.07] bg-base-800/90 p-1.5 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.9)] transition focus-within:border-accent-500/40 focus-within:ring-2 focus-within:ring-accent-500/10"
        >
          <textarea
            rows={1}
            value={draft}
            maxLength={4000}
            onChange={(event) => handleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={`发送消息到 #${channel.name}`}
            aria-label="消息内容"
            className="max-h-40 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14.5px] leading-6 text-mist-100 outline-none placeholder:text-mist-600"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-500 text-white transition hover:bg-accent-400 disabled:cursor-not-allowed disabled:bg-base-700 disabled:text-mist-600"
            aria-label="发送消息"
          >
            <Send size={16} />
          </button>
        </form>

        <p className="mx-auto mt-2 max-w-4xl px-1 text-[10px] text-mist-600">
          Enter 发送 · Shift + Enter 换行 · 消息会同步给频道里的所有人
        </p>
      </div>
    </section>
  );
}
