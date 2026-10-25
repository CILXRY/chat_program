import { globalShortcut } from 'electron';
import type { DesktopShortcut, ShortcutStatus } from '../shared/types';

const DEFINITIONS: Array<{
  accelerators: string[];
  label: string;
  action: 'toggle-mute' | 'toggle-window' | 'leave-voice';
}> = [
  {
    accelerators: [
      'CommandOrControl+Shift+M',
      'CommandOrControl+Alt+M',
      'CommandOrControl+Shift+U',
    ],
    label: '静音 / 取消静音',
    action: 'toggle-mute',
  },
  {
    accelerators: ['CommandOrControl+Shift+H', 'CommandOrControl+Alt+H'],
    label: '显示 / 隐藏窗口',
    action: 'toggle-window',
  },
  {
    accelerators: ['CommandOrControl+Shift+E', 'CommandOrControl+Alt+E'],
    label: '离开语音',
    action: 'leave-voice',
  },
];

let statuses: ShortcutStatus[] = DEFINITIONS.map((item) => ({
  accelerator: item.accelerators[0],
  label: item.label,
  action: item.action,
  registered: false,
}));

export function registerDesktopShortcuts(options: {
  enabled: boolean;
  toggleWindow: () => void;
  sendAction: (action: DesktopShortcut) => void;
}): ShortcutStatus[] {
  globalShortcut.unregisterAll();
  statuses = DEFINITIONS.map((item) => ({
    accelerator: item.accelerators[0],
    label: item.label,
    action: item.action,
    registered: false,
  }));

  if (!options.enabled) return getShortcutStatuses();

  for (const [index, item] of DEFINITIONS.entries()) {
    for (const accelerator of item.accelerators) {
      try {
        const registered = globalShortcut.register(accelerator, () => {
          if (item.action === 'toggle-window') {
            options.toggleWindow();
            return;
          }
          options.sendAction(item.action);
        });
        if (registered) {
          statuses[index] = {
            accelerator,
            label: item.label,
            action: item.action,
            registered: true,
          };
          break;
        }
        console.warn(`[shortcuts] ${accelerator} is already in use`);
      } catch (error) {
        console.warn(`[shortcuts] failed to register ${accelerator}`, error);
      }
    }
  }

  return getShortcutStatuses();
}

export function getShortcutStatuses(): ShortcutStatus[] {
  return statuses.map((item) => ({ ...item }));
}

export function unregisterDesktopShortcuts(): void {
  globalShortcut.unregisterAll();
}
