export type UserRole = 'admin' | 'member';

export interface User {
  id: number;
  username: string;
  display_name: string;
  avatar_color: string;
  role: UserRole;
  created_at: string;
}

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: number;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  created_by: number | null;
  created_at: string;
}

export interface Message {
  id: number;
  channel_id: number;
  content: string;
  created_at: string;
  edited_at: string | null;
  author: User;
  nonce?: string;
  pending?: boolean;
  failed?: boolean;
}

export interface MessagePage {
  items: Message[];
  has_more: boolean;
}

export interface VoiceParticipant {
  user_id: number;
  muted: boolean;
  sharing: boolean;
}

export interface TypingUser {
  id: number;
  display_name: string;
  expiresAt: number;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface VoiceState {
  channelId: number | null;
  status: 'idle' | 'connecting' | 'connected';
  muted: boolean;
  sharing: boolean;
  participants: VoiceParticipant[];
  remoteStreams: Record<number, MediaStream>;
  localScreen: MediaStream | null;
  localAudio: MediaStream | null;
  screenHdr: boolean;
  screenNative: boolean;
}

export type ServerEvent =
  | { type: 'ready'; user: User; online_user_ids: number[] }
  | { type: 'presence.update'; user_id: number; online: boolean }
  | { type: 'message.created'; message: Message; nonce: string | null }
  | { type: 'message.deleted'; channel_id: number; message_id: number }
  | { type: 'typing.start'; channel_id: number; user: { id: number; display_name: string } }
  | { type: 'channel.created'; channel: Channel }
  | { type: 'channel.updated'; channel: Channel }
  | { type: 'channel.deleted'; channel_id: number }
  | { type: 'user.created'; user: User }
  | { type: 'user.updated'; user: User }
  | { type: 'member.removed'; user_id: number }
  | { type: 'member.restored'; user: User }
  | { type: 'subscribed'; channel_id: number }
  | { type: 'voice.state'; channel_id: number; participants: VoiceParticipant[] }
  | {
      type: 'rtc.offer' | 'rtc.answer';
      from_user_id: number;
      channel_id: number;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: 'rtc.ice';
      from_user_id: number;
      channel_id: number;
      candidate: RTCIceCandidateInit;
    }
  | { type: 'error'; message: string };

export type ClientEvent =
  | { type: 'subscribe'; channel_id: number }
  | { type: 'unsubscribe'; channel_id: number }
  | { type: 'typing'; channel_id: number }
  | { type: 'voice.join'; channel_id: number }
  | { type: 'voice.leave' }
  | { type: 'voice.media'; channel_id: number; muted?: boolean; sharing?: boolean }
  | {
      type: 'rtc.offer' | 'rtc.answer';
      target_user_id: number;
      sdp: RTCSessionDescriptionInit;
    }
  | { type: 'rtc.ice'; target_user_id: number; candidate: RTCIceCandidateInit }
  | { type: 'ping' };
