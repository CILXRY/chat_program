import type { Channel, MessagePage, User } from '../types';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8000';

async function serverRequest<T>(path: string, cookie: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: {
        accept: 'application/json',
        cookie,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[server] request to ${path} failed`, error);
    return null;
  }
}

export function getChannels(cookie: string): Promise<Channel[] | null> {
  return serverRequest<Channel[]>('/api/channels', cookie);
}

export function getUsers(cookie: string): Promise<User[] | null> {
  return serverRequest<User[]>('/api/users', cookie);
}

export function getMessages(
  cookie: string,
  channelId: number,
): Promise<MessagePage | null> {
  return serverRequest<MessagePage>(
    `/api/channels/${channelId}/messages?limit=50`,
    cookie,
  );
}
