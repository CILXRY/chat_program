import { SdrScreenPipeline, isHdrDisplay, readForceSdr } from './screenCapture';
import { useChatStore } from './store';
import type { ServerEvent, VoiceParticipant } from './types';
import { chatSocket } from './ws';

type PeerState = {
  pc: RTCPeerConnection;
  remote: MediaStream;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
  mediaAttached: boolean;
};

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    {
      urls: import.meta.env.PUBLIC_STUN_URL || 'stun:stun.l.google.com:19302',
    },
  ];

  const turnUrl = import.meta.env.PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl
        .split(',')
        .map((url: string) => url.trim())
        .filter(Boolean),
      username: import.meta.env.PUBLIC_TURN_USERNAME,
      credential: import.meta.env.PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

class VoiceClient {
  private channelId: number | null = null;
  private selfId: number | null = null;
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  private screenPipeline: SdrScreenPipeline | null = null;
  private peers = new Map<number, PeerState>();
  private orphanIce = new Map<number, RTCIceCandidateInit[]>();
  private muted = false;
  private sharing = false;
  private joinToken = 0;
  private iceServers = buildIceServers();

  constructor() {
    if (import.meta.env.DEV) {
      (window as unknown as { __nebulaVoice?: VoiceClient }).__nebulaVoice = this;
    }
  }

  /** Development helper used by the automated WebRTC smoke test. */
  debugState() {
    return {
      channelId: this.channelId,
      selfId: this.selfId,
      sharing: this.sharing,
      peers: [...this.peers.entries()].map(([peerId, peer]) => ({
        peerId,
        signalingState: peer.pc.signalingState,
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        remoteTracks: peer.remote.getTracks().map((track) => ({
          kind: track.kind,
          readyState: track.readyState,
          muted: track.muted,
        })),
        transceivers: peer.pc.getTransceivers().map((transceiver) => ({
          mid: transceiver.mid,
          direction: transceiver.direction,
          currentDirection: transceiver.currentDirection,
          senderTrack: transceiver.sender.track?.kind ?? null,
          senderEnabled: transceiver.sender.track?.enabled ?? null,
          receiverTrack: transceiver.receiver.track?.kind ?? null,
        })),
      })),
    };
  }

  async join(channelId: number): Promise<void> {
    const me = useChatStore.getState().me;
    if (!me) return;
    if (this.channelId === channelId) return;
    if (this.channelId !== null) {
      this.leave();
    }

    this.channelId = channelId;
    this.selfId = me.id;
    this.muted = false;
    this.sharing = false;
    const token = ++this.joinToken;
    const store = useChatStore.getState();

    store.setVoice({
      channelId,
      status: 'connecting',
      muted: false,
      sharing: false,
      participants: [],
      remoteStreams: {},
      localScreen: null,
      localAudio: null,
    });

    const hasMic = await this.acquireMic();
    if (token !== this.joinToken || this.channelId !== channelId) {
      this.micStream?.getTracks().forEach((track) => track.stop());
      this.micStream = null;
      this.micTrack = null;
      return;
    }

    if (!hasMic) {
      this.muted = true;
      useChatStore
        .getState()
        .showToast('没有获取到麦克风权限，你已以静音状态加入', 'info');
    }

    useChatStore.getState().setVoice({
      muted: this.muted,
      localAudio: this.micStream,
    });

    const sent = chatSocket.send({ type: 'voice.join', channel_id: channelId });
    if (!sent) {
      this.teardown();
      useChatStore.getState().clearVoice();
      useChatStore.getState().showToast('实时连接不可用，无法加入语音频道', 'error');
      return;
    }
    if (this.muted) {
      chatSocket.send({
        type: 'voice.media',
        channel_id: channelId,
        muted: true,
      });
    }
  }

  leave(): void {
    this.joinToken += 1;
    if (this.channelId !== null) {
      chatSocket.send({ type: 'voice.leave' });
    }
    this.teardown();
    useChatStore.getState().clearVoice();
  }

  handleSocketDown(): void {
    if (this.channelId === null) return;
    this.joinToken += 1;
    this.teardown();
    useChatStore.getState().clearVoice();
    useChatStore.getState().showToast('实时连接已断开，已退出语音频道', 'error');
  }

  handleEvent(event: ServerEvent): void {
    if (event.type === 'voice.state') {
      this.onVoiceState(event.channel_id, event.participants);
      return;
    }
    if (event.type === 'rtc.offer') {
      void this.onOffer(event.from_user_id, event.sdp).catch((error) =>
        console.warn('[rtc] failed to handle offer', error),
      );
      return;
    }
    if (event.type === 'rtc.answer') {
      void this.onAnswer(event.from_user_id, event.sdp).catch((error) =>
        console.warn('[rtc] failed to handle answer', error),
      );
      return;
    }
    if (event.type === 'rtc.ice') {
      void this.onRemoteCandidate(event.from_user_id, event.candidate).catch((error) =>
        console.warn('[rtc] failed to add candidate', error),
      );
    }
  }

  async toggleMute(): Promise<void> {
    if (this.channelId === null) return;

    if (this.muted && !this.micTrack) {
      const acquired = await this.acquireMic();
      if (!acquired) {
        useChatStore.getState().showToast('没有可用的麦克风', 'error');
        return;
      }
      for (const peer of this.peers.values()) {
        if (peer.audioSender) {
          await peer.audioSender.replaceTrack(this.micTrack);
        }
      }
      useChatStore.getState().setVoice({ localAudio: this.micStream });
      this.muted = false;
    } else {
      this.muted = !this.muted;
    }

    if (this.micTrack) {
      this.micTrack.enabled = !this.muted;
    }
    useChatStore.getState().setVoice({ muted: this.muted });
    chatSocket.send({
      type: 'voice.media',
      channel_id: this.channelId,
      muted: this.muted,
    });
  }

  async toggleShare(): Promise<void> {
    if (this.sharing) {
      await this.stopShare();
      return;
    }
    if (this.channelId === null) return;

    let rawStream: MediaStream | null = null;
    try {
      const options = {
        video: {
          frameRate: { ideal: 30, max: 30 },
          cursor: 'always',
        },
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
      };
      rawStream = await navigator.mediaDevices.getDisplayMedia(
        options as DisplayMediaStreamOptions,
      );

      const rawVideoTrack = rawStream.getVideoTracks()[0];
      if (!rawVideoTrack) {
        rawStream.getTracks().forEach((track) => track.stop());
        return;
      }
      rawVideoTrack.addEventListener('ended', () => {
        void this.stopShare();
      });

      let stream = rawStream;
      let toneMapped = false;

      // WebRTC is SDR here. Force HDR screen captures through a canvas so
      // Chrome tone-maps PQ/Rec.2020 to sRGB before encoding.
      if (readForceSdr() || isHdrDisplay()) {
        const pipeline = new SdrScreenPipeline(rawStream, 30);
        if ((await pipeline.start()) && pipeline.stream) {
          this.screenPipeline = pipeline;
          stream = pipeline.stream;
          toneMapped = true;
        }
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        this.screenPipeline?.stop();
        this.screenPipeline = null;
        rawStream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.screenStream = stream;
      this.sharing = true;
      const screenAudioTrack = stream.getAudioTracks()[0] ?? null;

      for (const peer of this.peers.values()) {
        try {
          if (peer.videoSender) {
            await peer.videoSender.replaceTrack(videoTrack);
          }
          if (peer.screenAudioSender) {
            await peer.screenAudioSender.replaceTrack(screenAudioTrack);
          }
        } catch (error) {
          console.warn('[rtc] failed to attach screen track to a peer', error);
        }
      }

      useChatStore.getState().setVoice({
        sharing: true,
        localScreen: stream,
      });
      chatSocket.send({
        type: 'voice.media',
        channel_id: this.channelId,
        sharing: true,
      });
      useChatStore.getState().showToast(
        toneMapped ? '屏幕共享已开始（HDR 已转换为 SDR）' : '屏幕共享已开始',
        'info',
      );
    } catch (error) {
      this.screenPipeline?.stop();
      this.screenPipeline = null;
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      rawStream?.getTracks().forEach((track) => track.stop());
      this.sharing = false;
      useChatStore.getState().setVoice({ sharing: false, localScreen: null });

      const name = (error as DOMException | undefined)?.name;
      if (name === 'NotAllowedError') return;
      console.warn('[rtc] screen share failed', error);
      useChatStore
        .getState()
        .showToast('无法启动屏幕共享，请检查浏览器权限', 'error');
    }
  }

  async stopShare(): Promise<void> {
    if (!this.sharing && !this.screenStream) return;
    const stream = this.screenStream;
    const pipeline = this.screenPipeline;
    this.screenStream = null;
    this.screenPipeline = null;
    this.sharing = false;

    for (const peer of this.peers.values()) {
      try {
        if (peer.videoSender) {
          await peer.videoSender.replaceTrack(null);
        }
        if (peer.screenAudioSender) {
          await peer.screenAudioSender.replaceTrack(null);
        }
      } catch {
        // The peer may already be closed.
      }
    }

    pipeline?.stop();
    stream?.getTracks().forEach((track) => track.stop());
    useChatStore.getState().setVoice({ sharing: false, localScreen: null });
    if (this.channelId !== null) {
      chatSocket.send({
        type: 'voice.media',
        channel_id: this.channelId,
        sharing: false,
      });
    }
  }

  dispose(): void {
    this.joinToken += 1;
    this.teardown();
  }

  private async acquireMic(): Promise<boolean> {
    if (this.micTrack) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.micStream = stream;
      this.micTrack = stream.getAudioTracks()[0] ?? null;
      if (this.micTrack) {
        this.micTrack.enabled = !this.muted;
      }
      return this.micTrack !== null;
    } catch {
      this.micStream = null;
      this.micTrack = null;
      return false;
    }
  }

  private onVoiceState(channelId: number, participants: VoiceParticipant[]): void {
    if (channelId !== this.channelId || this.selfId === null) return;
    this.syncPeers(participants);
    useChatStore.getState().setVoice({
      status: 'connected',
      participants,
    });
  }

  private syncPeers(participants: VoiceParticipant[]): void {
    if (this.selfId === null) return;
    const present = new Set(participants.map((participant) => participant.user_id));

    for (const participant of participants) {
      if (participant.user_id === this.selfId) continue;
      if (!this.peers.has(participant.user_id)) {
        // Deterministic initiator avoids offer glare when both sides see a new peer.
        this.createPeer(participant.user_id, this.selfId > participant.user_id);
      }
    }

    for (const [peerId, peer] of [...this.peers.entries()]) {
      if (!present.has(peerId)) {
        this.destroyPeer(peerId, peer);
      }
    }
  }

  private createPeer(peerId: number, initiator: boolean): PeerState {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const remote = new MediaStream();

    const peer: PeerState = {
      pc,
      remote,
      audioSender: null,
      videoSender: null,
      screenAudioSender: null,
      pendingCandidates: [],
      hasRemoteDescription: false,
      mediaAttached: false,
    };
    this.peers.set(peerId, peer);

    // The offerer publishes three m-lines up front: microphone, screen video
    // and screen audio. The answerer attaches its own media to the transceivers
    // that the remote offer creates (Chrome does not associate transceivers
    // created before setRemoteDescription with that offer).
    if (initiator) {
      const audioTx = pc.addTransceiver(this.micTrack ?? 'audio', {
        direction: 'sendrecv',
      });
      const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
      const screenAudioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.audioSender = audioTx.sender;
      peer.videoSender = videoTx.sender;
      peer.screenAudioSender = screenAudioTx.sender;
      peer.mediaAttached = true;

      if (this.sharing && this.screenStream) {
        const videoTrack = this.screenStream.getVideoTracks()[0] ?? null;
        const audioTrack = this.screenStream.getAudioTracks()[0] ?? null;
        if (videoTrack) void videoTx.sender.replaceTrack(videoTrack);
        if (audioTrack) void screenAudioTx.sender.replaceTrack(audioTrack);
      }
    }

    const orphans = this.orphanIce.get(peerId);
    if (orphans) {
      peer.pendingCandidates.push(...orphans);
      this.orphanIce.delete(peerId);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      chatSocket.send({
        type: 'rtc.ice',
        target_user_id: peerId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      remote.addTrack(event.track);
      useChatStore.getState().setVoice({
        remoteStreams: {
          ...useChatStore.getState().voice.remoteStreams,
          [peerId]: remote,
        },
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`[rtc] peer ${peerId} connection failed`);
      }
    };

    if (initiator) {
      void this.sendOffer(peerId, pc);
    }

    return peer;
  }

  private async sendOffer(peerId: number, pc: RTCPeerConnection): Promise<void> {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      const description = pc.localDescription;
      if (!description) return;
      chatSocket.send({
        type: 'rtc.offer',
        target_user_id: peerId,
        sdp: { type: 'offer', sdp: description.sdp },
      });
    } catch (error) {
      console.warn('[rtc] failed to send offer', error);
    }
  }

  private async onOffer(
    fromUserId: number,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.channelId === null) return;
    const peer = this.peers.get(fromUserId) ?? this.createPeer(fromUserId, false);
    const pc = peer.pc;

    if (pc.signalingState === 'have-local-offer') {
      const polite = this.selfId !== null && this.selfId < fromUserId;
      if (!polite) return;
      await pc.setLocalDescription({ type: 'rollback' });
    }

    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
      return;
    }

    await pc.setRemoteDescription(sdp);
    peer.hasRemoteDescription = true;
    if (!peer.mediaAttached) {
      await this.attachLocalMedia(peer, pc.getTransceivers());
    }
    await this.flushCandidates(peer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const description = pc.localDescription;
    if (!description) return;
    chatSocket.send({
      type: 'rtc.answer',
      target_user_id: fromUserId,
      sdp: { type: 'answer', sdp: description.sdp },
    });
  }

  private async onAnswer(
    fromUserId: number,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const peer = this.peers.get(fromUserId);
    if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
    await peer.pc.setRemoteDescription(sdp);
    peer.hasRemoteDescription = true;
    await this.flushCandidates(peer);
  }

  private async onRemoteCandidate(
    fromUserId: number,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const peer = this.peers.get(fromUserId);
    if (!peer) {
      const queue = this.orphanIce.get(fromUserId) ?? [];
      queue.push(candidate);
      this.orphanIce.set(fromUserId, queue);
      return;
    }
    if (!peer.hasRemoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('[rtc] addIceCandidate failed', error);
    }
  }

  private async attachLocalMedia(
    peer: PeerState,
    transceivers: RTCRtpTransceiver[],
  ): Promise<void> {
    const videoTransceiver =
      transceivers.find((transceiver) => transceiver.receiver.track.kind === 'video') ??
      null;
    const audioTransceivers = transceivers.filter(
      (transceiver) => transceiver.receiver.track.kind === 'audio',
    );
    const micTransceiver = audioTransceivers[0] ?? null;
    const screenAudioTransceiver = audioTransceivers[1] ?? null;

    peer.audioSender = micTransceiver?.sender ?? null;
    peer.videoSender = videoTransceiver?.sender ?? null;
    peer.screenAudioSender = screenAudioTransceiver?.sender ?? null;

    if (micTransceiver) {
      micTransceiver.direction = 'sendrecv';
      await micTransceiver.sender.replaceTrack(this.micTrack);
    }

    if (videoTransceiver) {
      videoTransceiver.direction = 'sendrecv';
      const videoTrack = this.sharing
        ? (this.screenStream?.getVideoTracks()[0] ?? null)
        : null;
      await videoTransceiver.sender.replaceTrack(videoTrack);
    }

    if (screenAudioTransceiver) {
      screenAudioTransceiver.direction = 'sendrecv';
      const audioTrack = this.sharing
        ? (this.screenStream?.getAudioTracks()[0] ?? null)
        : null;
      await screenAudioTransceiver.sender.replaceTrack(audioTrack);
    }

    peer.mediaAttached = true;
  }

  private async flushCandidates(peer: PeerState): Promise<void> {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn('[rtc] queued candidate failed', error);
      }
    }
  }

  private destroyPeer(peerId: number, peer: PeerState): void {
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    this.peers.delete(peerId);
    this.orphanIce.delete(peerId);
    const streams = { ...useChatStore.getState().voice.remoteStreams };
    delete streams[peerId];
    useChatStore.getState().setVoice({ remoteStreams: streams });
  }

  private teardown(): void {
    for (const [peerId, peer] of [...this.peers.entries()]) {
      this.destroyPeer(peerId, peer);
    }
    this.peers.clear();
    this.orphanIce.clear();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.screenPipeline?.stop();
    this.screenPipeline = null;
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.micTrack = null;
    this.screenStream = null;
    this.channelId = null;
    this.selfId = null;
    this.muted = false;
    this.sharing = false;
  }
}

export const voiceClient = new VoiceClient();
