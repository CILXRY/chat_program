import { app } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function preloadPath(name: 'index' | 'settings' | 'picker'): string {
  return join(__dirname, `../preload/${name}.js`);
}

export function rendererPageUrl(page: 'settings.html' | 'picker.html'): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const base = devUrl.endsWith('/') ? devUrl : `${devUrl}/`;
    return new URL(page, base).toString();
  }
  return pathToFileURL(join(__dirname, `../renderer/${page}`)).toString();
}

function assetPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'build', name);
}

export function appIconPath(): string {
  return assetPath('icon.ico');
}

export function trayIconPath(): string {
  return assetPath('tray.png');
}
