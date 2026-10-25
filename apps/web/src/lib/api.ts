import type {
  Channel,
  ChannelType,
  Message,
  MessagePage,
  User,
} from './types';

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      ...init,
    });
  } catch {
    throw new ApiError(0, null, 'Network request failed');
  }

  if (!response.ok) {
    let detail: unknown = null;
    try {
      const data = (await response.json()) as { detail?: unknown };
      detail = data.detail ?? null;
    } catch {
      detail = null;
    }
    throw new ApiError(response.status, detail, `Request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  login(username: string, password: string): Promise<User> {
    return request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  register(input: {
    username: string;
    display_name?: string;
    password: string;
  }): Promise<User> {
    return request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  logout(): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST' });
  },

  getChannels(): Promise<Channel[]> {
    return request<Channel[]>('/api/channels');
  },

  getUsers(): Promise<User[]> {
    return request<User[]>('/api/users');
  },

  getMessages(channelId: number, before?: number): Promise<MessagePage> {
    const query = new URLSearchParams({ limit: '50' });
    if (before != null) query.set('before', String(before));
    return request<MessagePage>(`/api/channels/${channelId}/messages?${query.toString()}`);
  },

  sendMessage(
    channelId: number,
    content: string,
    nonce: string,
  ): Promise<Message & { nonce?: string | null }> {
    return request<Message & { nonce?: string | null }>(
      `/api/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content, nonce }),
      },
    );
  },

  deleteMessage(messageId: number): Promise<void> {
    return request<void>(`/api/messages/${messageId}`, { method: 'DELETE' });
  },

  createChannel(input: {
    name: string;
    type: ChannelType;
    topic?: string;
  }): Promise<Channel> {
    return request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
