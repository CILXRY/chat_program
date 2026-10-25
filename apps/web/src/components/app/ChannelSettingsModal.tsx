import { Hash, LoaderCircle, Trash2, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { voiceClient } from '../../lib/rtc';
import { useChatStore } from '../../lib/store';
import type { Channel } from '../../lib/types';

interface Props {
  channel: Channel;
  onClose: () => void;
}

export default function ChannelSettingsModal({ channel, onClose }: Props) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelCount = useChatStore((state) => state.channels.length);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || deleting) return;
    const normalized = name.trim();
    if (!normalized) {
      setError('给频道起个名字吧。');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const updated = await api.updateChannel(channel.id, {
        name: normalized,
        topic: topic.trim() || null,
      });
      useChatStore.getState().updateChannel(updated);
      useChatStore.getState().showToast('频道已更新', 'info');
      onClose();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 409) {
        setError('已经有同名频道了，换一个名字。');
      } else if (submitError instanceof ApiError && submitError.status === 422) {
        setError('频道名只能包含文字、数字、- 或 _，最多 24 个字符。');
      } else if (submitError instanceof ApiError && submitError.status === 403) {
        setError('你没有修改这个频道的权限。');
      } else {
        setError('保存失败，请稍后再试。');
      }
      setPending(false);
    }
  }

  async function handleDelete() {
    if (pending || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteChannel(channel.id);
      const state = useChatStore.getState();
      if (state.voice.channelId === channel.id) {
        voiceClient.leave();
      }
      state.removeChannel(channel.id);
      state.showToast(`频道 #${channel.name} 已删除`, 'info');
      onClose();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 403) {
        setError('你没有删除这个频道的权限。');
      } else if (submitError instanceof ApiError && submitError.status === 400) {
        setError('至少需要保留一个频道。');
      } else {
        setError('删除失败，请稍后再试。');
      }
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={() => (pending || deleting ? undefined : onClose())}
      />
      <div className="animate-pop relative w-full max-w-md rounded-3xl border border-white/10 bg-base-900 p-6 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">频道设置</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-mist-500">
              {channel.type === 'text' ? <Hash size={13} /> : <Volume2 size={13} />}
              {channel.type === 'text' ? '文字频道' : '语音频道'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending || deleting}
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200 disabled:opacity-50"
            aria-label="关闭"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="edit-channel-name"
              className="mb-1.5 block text-xs font-medium text-mist-400"
            >
              频道名称
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-mist-600">
                {channel.type === 'text' ? '#' : '🔊'}
              </span>
              <input
                id="edit-channel-name"
                autoFocus
                required
                maxLength={24}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-11 w-full rounded-xl border border-base-700 bg-base-950/60 pl-9 pr-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-channel-topic"
              className="mb-1.5 block text-xs font-medium text-mist-400"
            >
              频道说明 <span className="font-normal text-mist-600">（可选）</span>
            </label>
            <input
              id="edit-channel-topic"
              maxLength={160}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="一句话说明这个频道"
              className="h-11 w-full rounded-xl border border-base-700 bg-base-950/60 px-3 text-sm text-mist-100 outline-none transition placeholder:text-mist-600 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/15"
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
              disabled={pending || deleting}
              className="h-10 rounded-xl px-4 text-sm text-mist-400 transition hover:bg-white/5 hover:text-mist-200 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={pending || deleting}
              className="flex h-10 items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-400 disabled:opacity-60"
            >
              {pending && <LoaderCircle size={15} className="animate-spin" />}
              保存修改
            </button>
          </div>
        </form>

        <div className="mt-6 rounded-2xl border border-danger-400/15 bg-danger-400/[0.04] p-4">
          <h3 className="text-xs font-semibold text-danger-400">危险操作</h3>
          <p className="mt-1 text-[11px] leading-5 text-mist-500">
            删除频道会同时删除其中的全部消息，且无法恢复。
            {channelCount <= 1 && ' 至少需要保留一个频道。'}
          </p>
          {confirmDelete ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-danger-400/90 px-3 text-[11px] font-medium text-white transition hover:bg-danger-400 disabled:opacity-60"
              >
                {deleting && <LoaderCircle size={12} className="animate-spin" />}
                确认删除 #{channel.name}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-8 rounded-lg px-2.5 text-[11px] text-mist-400 transition hover:text-mist-200"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={channelCount <= 1 || pending || deleting}
              className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-danger-400/20 bg-danger-400/10 px-3 text-[11px] text-danger-400 transition hover:bg-danger-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={12} />
              删除频道
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
