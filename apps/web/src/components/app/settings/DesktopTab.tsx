import { ExternalLink, Monitor, Settings } from 'lucide-react';
import { desktopPlatform, openDesktopSettings } from '../../../lib/desktop';

const platformLabel: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

export default function DesktopTab() {
  const platform = desktopPlatform();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-mist-100">桌面客户端</h3>
        <p className="mt-1 text-xs leading-5 text-mist-500">
          窗口、托盘、开机启动和全局快捷键在原生设置里；账号和通知偏好与网页端共用。
        </p>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-base-800 text-accent-300">
            <Monitor size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-mist-100">Nebula Desktop</p>
            <p className="text-[11px] text-mist-500">
              {platform ? (platformLabel[platform] ?? platform) : '桌面环境'}
            </p>
          </div>
          <span className="rounded-full border border-mint-400/20 bg-mint-400/10 px-2 py-0.5 text-[10px] text-mint-400">
            已启用
          </span>
        </div>

        <button
          type="button"
          onClick={openDesktopSettings}
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 text-sm font-medium text-white transition hover:bg-accent-400"
        >
          <Settings size={15} />
          打开 Windows 客户端设置
        </button>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-base-950/40 p-4">
        <h4 className="text-sm font-medium text-mist-100">原生设置包含</h4>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-mist-500">
          <li>· 服务器地址与本机 / 远程模式</li>
          <li>· 关闭到托盘、开机启动、启动时最小化</li>
          <li>· 语音 / 共享状态通知开关</li>
          <li>· 全局快捷键状态与自动更新</li>
        </ul>
      </div>

      <a
        href="https://github.com/CILXRY/chat_program"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] text-mist-500 transition hover:text-mist-300"
      >
        <ExternalLink size={12} />
        查看项目主页
      </a>
    </div>
  );
}
