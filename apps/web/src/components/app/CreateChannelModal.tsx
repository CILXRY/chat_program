import { Hash, LoaderCircle, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useChatStore } from '../../lib/store';
import type { Channel, ChannelType } from '../../lib/types';

interface Props {
  defaultType?: ChannelType;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}

export default function CreateChannelModal({
  defaultType = 'text',
  onClose,
  onCreated,
}: Props) {
  const [type, setType] = useState<ChannelType>(defaultType);
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const normalized = name.trim();
    if (!normalized) {
      setError('给频道起个名字吧。');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const channel = await api.createChannel({
        name: normalized,
        type,
        topic: topic.trim() || undefined,
      });
      useChatStore.getState().addChannel(channel);
      onCreated(channel);
      onClose();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 409) {
        setError('已经有同名频道了，换一个名字。');
      } else if (submitError instanceof ApiError && submitError.status === 422) {
        setError('频道名只能包含文字、数字、- 或 _，最多 24 个字符。');
      } else {
        setError('创建失败，请稍后再试。');
      }
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="animate-pop relative w-full max-w-md rounded-3xl border border-white/10 bg-base-900 p-6 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">创建频道</h2>
            <p className="mt-1 text-xs text-mist-500">
              文字频道用来聊天，语音频道用来开麦和共享屏幕。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200"
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <span className="mb-2 block text-xs font-medium text-mist-400">频道类型</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('text')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                  type === 'text'
                    ? 'border-accent-500/60 bg-accent-500/10'
                    : 'border-base-700 bg-base-950/40 hover:border-base-600'
                }`}
              >
                <Hash
                  size={18}
                  className={type === 'text' ? 'text-accent-300' : 'text-mist-500'}
                />
                <span>
                  <span className="block text-sm font-medium">文字</span>
                  <span className="mt-0.5 block text-[11px] text-mist-500">
                    消息与讨论
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setType('voice')}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                  type === 'voice'
                    ? 'border-mint-400/50 bg-mint-400/10'
                    : 'border-base-700 bg-base-950/40 hover:border-base-600'
                }`}
              >
                <Volume2
                  size={18}
                  className={type === 'voice' ? 'text-mint-400' : 'text-mist-500'}
                />
                <span>
                  <span className="block text-sm font-medium">语音</span>
                  <span className="mt-0.5 block text-[11px] text-mist-500">
                    通话与屏幕共享
                  </span>
                </span>
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="channel-name"
              className="mb-1.5 block text-xs font-medium text-mist-400"
            >
              频道名称
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-mist-600">
                {type === 'text' ? '#' : '🔊'}
              </span>
              <input
                id="channel-name"
                autoFocus
                required
                maxLength={24}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={type === 'text' ? '例如 design' : '例如 深夜电台'}
                className="h-11 w-full rounded-xl border border-base-700 bg-base-950/60 pl-9 pr-3 text-sm outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-mist-600">
              建议使用小写字母、数字和连字符。
            </p>
          </div>

          <div>
            <label
              htmlFor="channel-topic"
              className="mb-1.5 block text-xs font-medium text-mist-400"
            >
              频道说明 <span className="font-normal text-mist-600">（可选）</span>
            </label>
            <input
              id="channel-topic"
              maxLength={160}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="一句话说明这个频道"
              className="h-11 w-full rounded-xl border border-base-700 bg-base-950/60 px-3 text-sm outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-danger-400/20 bg-danger-400/10 px-3 py-2 text-xs text-danger-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl px-4 text-sm text-mist-400 transition hover:bg-white/5 hover:text-mist-200"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex h-10 items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-400 disabled:opacity-60"
            >
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              创建频道
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
