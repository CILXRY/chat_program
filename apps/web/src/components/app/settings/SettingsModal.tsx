import { Bell, Monitor, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useChatStore } from '../../../lib/store';
import { isDesktopClient } from '../../../lib/desktop';
import AccountTab from './AccountTab';
import DesktopTab from './DesktopTab';
import MembersTab from './MembersTab';
import PreferencesTab from './PreferencesTab';
import SecurityTab from './SecurityTab';

interface Props {
  onClose: () => void;
}

type TabId = 'account' | 'security' | 'preferences' | 'members' | 'desktop';

interface Tab {
  id: TabId;
  label: string;
  icon: ReactNode;
  render: () => ReactNode;
}

export default function SettingsModal({ onClose }: Props) {
  const me = useChatStore((state) => state.me);
  const [active, setActive] = useState<TabId>('account');
  const [desktop] = useState(() => isDesktopClient());

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!me) return null;

  const tabs: Tab[] = [
    {
      id: 'account',
      label: '账号',
      icon: <UserRound size={16} />,
      render: () => <AccountTab />,
    },
    {
      id: 'security',
      label: '安全',
      icon: <ShieldCheck size={16} />,
      render: () => <SecurityTab />,
    },
    {
      id: 'preferences',
      label: '通知与界面',
      icon: <Bell size={16} />,
      render: () => <PreferencesTab />,
    },
  ];

  if (me.role === 'admin') {
    tabs.push({
      id: 'members',
      label: '成员',
      icon: <Users size={16} />,
      render: () => <MembersTab />,
    });
  }

  if (desktop) {
    tabs.push({
      id: 'desktop',
      label: '桌面客户端',
      icon: <Monitor size={16} />,
      render: () => <DesktopTab />,
    });
  }

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center sm:p-6">
      <button
        type="button"
        aria-label="关闭设置"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="animate-pop relative flex h-dvh w-full max-w-3xl flex-col overflow-hidden border-white/10 bg-base-900 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)] sm:h-[min(760px,92dvh)] sm:rounded-3xl sm:border">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 px-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight">设置</h2>
            <p className="text-[11px] text-mist-500">账号、通知和工作区管理</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg text-mist-500 transition hover:bg-white/5 hover:text-mist-200"
            aria-label="关闭设置"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className="thin-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-3 py-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-2 sm:py-4"
            aria-label="设置分类"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                  current.id === tab.id
                    ? 'bg-white/[0.07] text-mist-50'
                    : 'text-mist-400 hover:bg-white/[0.035] hover:text-mist-200'
                }`}
                aria-current={current.id === tab.id ? 'page' : undefined}
              >
                <span className={current.id === tab.id ? 'text-accent-300' : 'text-mist-600'}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {current.render()}
          </div>
        </div>
      </div>
    </div>
  );
}
