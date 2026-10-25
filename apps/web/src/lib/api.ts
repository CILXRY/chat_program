import type {
  Channel,
  ChannelType,
  Message,
  MessagePage,
  User,
  UserRole,
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
  login(username: string, password: string, remember = true): Promise<User> {
    return request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, remember }),
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

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return request<void>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  },

  getChannels(): Promise<Channel[]> {
    return request<Channel[]>('/api/channels');
  },

  getUsers(): Promise<User[]> {
    return request<User[]>('/api/users');
  },

  getRemovedUsers(): Promise<User[]> {
    return request<User[]>('/api/users?removed=true');
  },

  updateProfile(input: {
    display_name?: string;
    avatar_color?: string;
  }): Promise<User> {
    return request<User>('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  removeMember(userId: number): Promise<void> {
    return request<void>(`/api/users/${userId}`, { method: 'DELETE' });
  },

  restoreMember(userId: number): Promise<User> {
    return request<User>(`/api/users/${userId}/restore`, { method: 'POST' });
  },

  setUserRole(userId: number, role: UserRole): Promise<User> {
    return request<User>(`/api/users/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
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

  updateChannel(
    channelId: number,
    input: { name?: string; topic?: string | null },
  ): Promise<Channel> {
    return request<Channel>(`/api/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  deleteChannel(channelId: number): Promise<void> {
    return request<void>(`/api/channels/${channelId}`, { method: 'DELETE' });
  },
};
