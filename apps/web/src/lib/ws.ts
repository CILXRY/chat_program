import type { ClientEvent, ServerEvent } from './types';

export type SocketStatus = 'connecting' | 'open' | 'closed';

type EventHandler = (event: ServerEvent) => void;
type StatusHandler = (status: SocketStatus) => void;

class ChatSocket {
  private socket: WebSocket | null = null;
  private eventHandlers = new Set<EventHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private attempts = 0;
  private manuallyClosed = true;

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.manuallyClosed = false;
    this.open();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  send(event: ClientEvent): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(event));
    return true;
  }

  private emitStatus(status: SocketStatus): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }

  private open(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.emitStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.emitStatus('open');
      this.startHeartbeat();
    };

    socket.onmessage = (raw) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(raw.data as string) as ServerEvent;
      } catch {
        return;
      }
      if ((event as { type?: string }).type === 'pong') {
        return;
      }
      for (const handler of this.eventHandlers) {
        handler(event);
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    socket.onclose = (event) => {
      this.stopHeartbeat();
      if (this.socket === socket) {
        this.socket = null;
      }
      if (event.code === 4401) {
        // The account was removed or the session expired: stop retrying.
        this.manuallyClosed = true;
        this.emitStatus('closed');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.assign('/login');
        }
        return;
      }
      this.emitStatus('closed');
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(1000 * 2 ** this.attempts, 15000);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed) {
        this.open();
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, 25000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const chatSocket = new ChatSocket();
