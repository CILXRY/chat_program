import { Notification, type BrowserWindow } from 'electron';
import { getConfig } from './config';
import { appIconPath } from './paths';

let getMainWindow: () => BrowserWindow | null = () => null;

export function initNotifications(getter: () => BrowserWindow | null): void {
  getMainWindow = getter;
}

export function showDesktopNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (!getConfig().notifications) return;
  if (!Notification.isSupported()) return;

  const window = getMainWindow();
  if (window && window.isVisible() && window.isFocused()) return;

  const notification = new Notification({
    title: title.slice(0, 120),
    body: body.slice(0, 500),
    icon: appIconPath(),
    silent: false,
  });

  notification.on('click', () => {
    if (onClick) {
      onClick();
      return;
    }
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  notification.show();
}
