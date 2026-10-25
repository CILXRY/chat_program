export interface LastLogin {
  username: string;
  display_name: string;
  avatar_color: string;
  remember: boolean;
  at: string;
}

const KEY = 'nebula:last-login';

export function readLastLogin(): LastLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LastLogin> | null;
    if (!value || typeof value.username !== 'string' || !value.username) return null;
    return {
      username: value.username,
      display_name:
        typeof value.display_name === 'string' && value.display_name
          ? value.display_name
          : value.username,
      avatar_color:
        typeof value.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.avatar_color)
          ? value.avatar_color
          : '#8b7cff',
      remember: value.remember !== false,
      at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeLastLogin(input: {
  username: string;
  display_name: string;
  avatar_color: string;
  remember: boolean;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const value: LastLogin = { ...input, at: new Date().toISOString() };
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Ignore quota/privacy-mode failures; quick login is a convenience only.
  }
}

export function clearLastLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}
