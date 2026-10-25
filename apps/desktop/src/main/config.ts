import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_CONFIG,
  type DesktopConfig,
  type ServerMode,
} from '../shared/types';

let cached: DesktopConfig | null = null;

function configFile(): string {
  return join(app.getPath('userData'), 'config.json');
}

function normalize(raw: Partial<DesktopConfig> | null | undefined): DesktopConfig {
  const value = raw ?? {};
  const mode: ServerMode = value.mode === 'remote' ? 'remote' : 'local';
  return {
    version: 1,
    configured: value.configured === true,
    mode,
    remoteUrl: cleanUrl(value.remoteUrl),
    localUrl: cleanUrl(value.localUrl) || DEFAULT_CONFIG.localUrl,
    autoStart: value.autoStart === true,
    startMinimized: value.startMinimized === true,
    closeToTray: value.closeToTray !== false,
    notifications: value.notifications !== false,
    shortcutsEnabled: value.shortcutsEnabled !== false,
  };
}

function cleanUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

export function loadConfig(): DesktopConfig {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<DesktopConfig>;
    cached = normalize(raw);
  } catch {
    cached = normalize(DEFAULT_CONFIG);
  }
  return cached;
}

export function getConfig(): DesktopConfig {
  return cached ?? loadConfig();
}

export function saveConfig(next: DesktopConfig): DesktopConfig {
  const normalized = normalize(next);
  cached = normalized;
  mkdirSync(dirname(configFile()), { recursive: true });
  const temp = `${configFile()}.tmp`;
  writeFileSync(temp, JSON.stringify(normalized, null, 2), 'utf8');
  renameSync(temp, configFile());
  return normalized;
}

export function getServerUrl(config: DesktopConfig = getConfig()): string {
  const raw = config.mode === 'remote' ? config.remoteUrl : config.localUrl;
  return cleanUrl(raw);
}

/**
 * Returns a user-facing error, or null when the URL is usable as the app root.
 */
export function validateServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return '请填写服务器地址';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '地址格式不正确';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '只支持 http:// 或 https:// 地址';
  }
  if (url.username || url.password) {
    return '地址中不能包含用户名或密码';
  }
  if (url.search || url.hash) {
    return '请填写站点根地址，不要带查询参数';
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return '请填写站点根地址，不要带路径';
  }
  return null;
}

export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
