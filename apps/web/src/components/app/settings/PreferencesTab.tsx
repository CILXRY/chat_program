import { Bell, LayoutList, Monitor } from 'lucide-react';
import {
  usePrefs,
  setPrefs,
  type MessageDensity,
  type ScreenQuality,
} from '../../../lib/prefs';
import { isDesktopClient } from '../../../lib/desktop';

const densities: { value: MessageDensity; label: string; hint: string }[] = [
  { value: 'comfortable', label: '舒适', hint: '默认行距，适合日常聊天' },
  { value: 'compact', label: '紧凑', hint: '更小的间距，一屏看到更多消息' },
];

const qualities: { value: ScreenQuality; label: string; hint: string }[] = [
  { value: '720p', label: '720p', hint: '最流畅，适合动态画面' },
  { value: '900p', label: '900p', hint: '平衡画质与 30fps（默认）' },
  { value: '1080p', label: '1080p', hint: '文字最清晰，占用更多 CPU' },
];

export default function PreferencesTab() {
  const prefs = usePrefs();
  const desktop = isDesktopClient();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-mist-100">通知与界面</h3>
        <p className="mt-1 text-xs leading-5 text-mist-500">
          这些偏好只保存在当前设备，不影响其他成员。
        </p>
      </div>

      <section className="rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-base-800 text-accent-300">
            <Bell size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-mist-100">桌面通知</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-mist-500">
                  窗口不在前台时，提示语音连接和他人开始共享屏幕。
                  {!desktop && ' 安装 Windows 客户端后生效。'}
                </span>
              </span>
              <input
                type="checkbox"
                checked={prefs.desktopNotifications}
                onChange={(event) =>
                  setPrefs({ desktopNotifications: event.target.checked })
                }
                className="mt-1 h-4 w-4 shrink-0 accent-accent-500"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-base-800 text-accent-300">
            <Monitor size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-mist-100">屏幕共享画质</p>
            <p className="mt-0.5 text-[11px] leading-5 text-mist-500">
              桌面端使用 WGC 原生采集并按此分辨率输出；HDR 画面始终先经过 ACES → SDR。下次共享生效。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {qualities.map((quality) => {
                const selected = prefs.screenQuality === quality.value;
                return (
                  <button
                    key={quality.value}
                    type="button"
                    onClick={() => setPrefs({ screenQuality: quality.value })}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-accent-500/50 bg-accent-500/10'
                        : 'border-base-700 bg-base-950/40 hover:border-base-600'
                    }`}
                    aria-pressed={selected}
                  >
                    <span className="block text-sm font-medium text-mist-100">
                      {quality.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-mist-500">
                      {quality.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-base-800 text-mint-400">
            <LayoutList size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-mist-100">消息密度</p>
            <p className="mt-0.5 text-[11px] leading-5 text-mist-500">
              调整聊天区消息之间的间距，立即生效。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {densities.map((density) => {
                const selected = prefs.messageDensity === density.value;
                return (
                  <button
                    key={density.value}
                    type="button"
                    onClick={() => setPrefs({ messageDensity: density.value })}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-accent-500/50 bg-accent-500/10'
                        : 'border-base-700 bg-base-950/40 hover:border-base-600'
                    }`}
                    aria-pressed={selected}
                  >
                    <span className="block text-sm font-medium text-mist-100">
                      {density.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-mist-500">
                      {density.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
