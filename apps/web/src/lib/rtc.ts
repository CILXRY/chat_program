import { audioEngine } from './audio/engine';
import { startNativeCapture, type NativeCaptureSession } from './audio/nativeCapture';
import { notifyDesktop } from './desktop';
import { getPrefs } from './prefs';
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

/**
 * Opus discontinuous transmission stops sending RTP payloads while the VAD
 * gate is closed, so an idle microphone costs almost no bandwidth. The SDP is
 * rewritten before it reaches the peer connection.
 */
function enableOpusDtx(sdp: string): string {
  const normalized = sdp.replace(/\r\n/g, '\n');
  // Only the first audio m-section is the microphone. Applying DTX to the
  // system-audio section would cut quiet passages out of shared music.
  const blocks = normalized.split(/(?=^m=)/m);

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    if (!block.startsWith('m=audio')) continue;

    const opusPayloadType = /^a=rtpmap:(\d+)\s+opus\/48000/im.exec(block)?.[1];
    if (!opusPayloadType) return sdp;

    const fmtpPrefix = `a=fmtp:${opusPayloadType} `;
    const lines = block.split('\n');
    let found = false;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith(fmtpPrefix)) continue;
      found = true;
      let parameters = lines[index].slice(fmtpPrefix.length);
      if (!/usedtx=/i.test(parameters)) parameters += ';usedtx=1';
      if (!/useinbandfec=/i.test(parameters)) parameters += ';useinbandfec=1';
      if (!/minptime=/i.test(parameters)) parameters += ';minptime=10';
      lines[index] = fmtpPrefix + parameters;
    }
    if (!found) {
      const rtpmapIndex = lines.findIndex((line) =>
        line.toLowerCase().startsWith(`a=rtpmap:${opusPayloadType} `),
      );
      if (rtpmapIndex >= 0) {
        lines.splice(rtpmapIndex + 1, 0, `${fmtpPrefix}usedtx=1;useinbandfec=1;minptime=10`);
      }
    }
    blocks[blockIndex] = lines.join('\n');
    return blocks.join('').replace(/\n/g, '\r\n');
  }
  return sdp;
}

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
  private nativeCapture: NativeCaptureSession | null = null;
  private peers = new Map<number, PeerState>();
  private orphanIce = new Map<number, RTCIceCandidateInit[]>();
  private muted = false;
  private sharing = false;
  private joinToken = 0;
  private announcedConnected = false;
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
    this.announcedConnected = false;
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
      screenHdr: false,
      screenNative: false,
    });

    const hasMic = await this.acquireMic();
    if (token !== this.joinToken || this.channelId !== channelId) {
      void audioEngine.stop();
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
    const channel = useChatStore
      .getState()
      .channels.find((item) => item.id === this.channelId);
    this.joinToken += 1;
    this.teardown();
    useChatStore.getState().clearVoice();
    useChatStore.getState().showToast('实时连接已断开，已退出语音频道', 'error');
    notifyDesktop(
      '语音连接已断开',
      channel ? `已退出 #${channel.name}` : '实时连接中断，已退出语音频道',
    );
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

    audioEngine.setMuted(this.muted);
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

  /** Applies microphone / AEC / denoiser changes without leaving the call. */
  async updateAudioSettings(): Promise<void> {
    const stream = await audioEngine.start(getPrefs().audio);
    if (!stream) return;
    await audioEngine.applyPreferences(getPrefs().audio);
    const track = audioEngine.track ?? stream.getAudioTracks()[0] ?? null;
    if (!track) return;
    if (track !== this.micTrack) {
      this.micTrack = track;
      this.micStream = stream;
      for (const peer of this.peers.values()) {
        if (peer.audioSender) {
          await peer.audioSender.replaceTrack(track);
        }
      }
    }
    track.enabled = !this.muted;
    useChatStore.getState().setVoice({
      localAudio: this.micStream,
      muted: this.muted,
    });
  }

  async toggleShare(source: 'screen' | 'window' = 'screen'): Promise<void> {
    if (this.sharing) {
      await this.stopShare();
      return;
    }
    if (this.channelId === null) return;

    let rawStream: MediaStream | null = null;
    let stream: MediaStream | null = null;
    let audioFallback = false;
    let toneMapped = false;
    let native = false;

    try {
      const quality = getPrefs().screenQuality;
      if (window.__TAURI__) {
        const session = await startNativeCapture(
          isHdrDisplay() || readForceSdr(),
          source,
          quality,
        );
        if (!session) return; // The native picker was cancelled.
        this.nativeCapture = session;
        session.onEnded = () => {
          void this.stopShare();
        };
        stream = session.stream;
        toneMapped = session.info.hdr;
        native = true;
      } else {
        const maxWidth = quality === '720p' ? 1280 : quality === '1080p' ? 1920 : 1600;
        const maxHeight = quality === '720p' ? 720 : quality === '1080p' ? 1080 : 900;
        const options = {
          video: {
            width: { ideal: maxWidth },
            height: { ideal: maxHeight },
            frameRate: { ideal: 30, max: 30 },
            cursor: 'always',
          },
          audio: true,
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          monitorTypeSurfaces: 'include',
        };
        try {
          rawStream = await navigator.mediaDevices.getDisplayMedia(
            options as DisplayMediaStreamOptions,
          );
        } catch (error) {
          const errorName = (error as DOMException | undefined)?.name;
          if (errorName === 'NotReadableError') {
            audioFallback = true;
            rawStream = await navigator.mediaDevices.getDisplayMedia({
              ...options,
              audio: false,
              systemAudio: 'exclude',
            } as DisplayMediaStreamOptions);
          } else {
            throw error;
          }
        }

        const rawVideoTrack = rawStream.getVideoTracks()[0];
        if (!rawVideoTrack) {
          rawStream.getTracks().forEach((track) => track.stop());
          return;
        }
        rawVideoTrack.contentHint = 'detail';
        rawVideoTrack.addEventListener('ended', () => {
          void this.stopShare();
        });

        stream = rawStream;
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
      }

      const videoTrack = stream?.getVideoTracks()[0];
      if (!stream || !videoTrack) {
        this.screenPipeline?.stop();
        this.screenPipeline = null;
        rawStream?.getTracks().forEach((track) => track.stop());
        await this.nativeCapture?.stop().catch(() => undefined);
        this.nativeCapture = null;
        return;
      }

      this.screenStream = stream;
      this.sharing = true;
      const screenAudioTrack = stream.getAudioTracks()[0] ?? null;
      if (screenAudioTrack) {
        // System audio is also played through the local speakers, so include
        // it in the echo-correlation reference.
        audioEngine.attachReference('screen-share', stream);
      }

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
        screenHdr: toneMapped,
        screenNative: native,
      });
      chatSocket.send({
        type: 'voice.media',
        channel_id: this.channelId,
        sharing: true,
      });

      const notes: string[] = [];
      if (native) notes.push('WGC 原生采集');
      if (toneMapped) notes.push('HDR → SDR tone mapping');
      if (audioFallback) notes.push('系统声音不可用，仅共享画面');
      useChatStore
        .getState()
        .showToast(
          notes.length > 0
            ? `屏幕共享已开始（${notes.join('；')}）`
            : '屏幕共享已开始',
          'info',
        );
    } catch (error) {
      this.screenPipeline?.stop();
      this.screenPipeline = null;
      await this.nativeCapture?.stop().catch(() => undefined);
      this.nativeCapture = null;
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      rawStream?.getTracks().forEach((track) => track.stop());
      this.sharing = false;
      useChatStore.getState().setVoice({
        sharing: false,
        localScreen: null,
        screenHdr: false,
        screenNative: false,
      });

      const name = (error as DOMException | undefined)?.name;
      if (name === 'NotAllowedError') return;
      console.warn('[rtc] screen share failed', error);
      useChatStore
        .getState()
        .showToast(
          window.__TAURI__
            ? '无法启动原生屏幕共享，请重试或检查 Windows 隐私设置'
            : '无法启动屏幕共享，请检查浏览器权限',
          'error',
        );
    }
  }

  async stopShare(): Promise<void> {
    if (!this.sharing && !this.screenStream) return;
    const stream = this.screenStream;
    const pipeline = this.screenPipeline;
    const native = this.nativeCapture;
    this.screenStream = null;
    this.screenPipeline = null;
    this.nativeCapture = null;
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
    audioEngine.detachReference('screen-share');
    await native?.stop().catch(() => undefined);
    stream?.getTracks().forEach((track) => track.stop());
    useChatStore.getState().setVoice({
      sharing: false,
      localScreen: null,
      screenHdr: false,
      screenNative: false,
    });
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
      const stream = await audioEngine.start(getPrefs().audio);
      if (!stream) {
        this.micStream = null;
        this.micTrack = null;
        return false;
      }
      this.micStream = stream;
      this.micTrack = audioEngine.track ?? stream.getAudioTracks()[0] ?? null;
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

    if (!this.announcedConnected) {
      this.announcedConnected = true;
      const channel = useChatStore
        .getState()
        .channels.find((item) => item.id === channelId);
      notifyDesktop(
        '语音已连接',
        channel ? `已加入 #${channel.name}` : '已加入语音频道',
      );
    }
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
      // Tap the incoming playback as the AEC / echo-overlap reference. The tap
      // is analysis-only; normal playback still happens in the <audio> tags.
      audioEngine.attachReference(String(peerId), remote);
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
      const offer = await pc.createOffer();
      const sdp = offer.sdp ? enableOpusDtx(offer.sdp) : offer.sdp;
      await pc.setLocalDescription({ type: offer.type, sdp });
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
    const answerSdp = answer.sdp ? enableOpusDtx(answer.sdp) : answer.sdp;
    await pc.setLocalDescription({ type: answer.type, sdp: answerSdp });
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
    audioEngine.detachReference(String(peerId));
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
    void audioEngine.stop();
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
    this.announcedConnected = false;
  }
}

export const voiceClient = new VoiceClient();
