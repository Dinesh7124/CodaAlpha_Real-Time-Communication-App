const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 4,
};

export async function loadIceServers() {
  try {
    const res = await fetch('/api/ice', { credentials: 'same-origin' });
    if (!res.ok) return ICE_CONFIG;
    const data = await res.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      ICE_CONFIG.iceServers = data.iceServers;
    }
  } catch { /* ignore */ }
  return ICE_CONFIG;
}

export class Mesh {
  constructor({ socket, onRemoteStream, onPeerLeft, onPeerState, onPeerMedia, onPeerStats, onSpeaking }) {
    this.socket = socket;
    this.onRemoteStream = onRemoteStream || (() => {});
    this.onPeerLeft = onPeerLeft || (() => {});
    this.onPeerState = onPeerState || (() => {});
    this.onPeerMedia = onPeerMedia || (() => {});
    this.onPeerStats = onPeerStats || (() => {});
    this.onSpeaking = onSpeaking || (() => {});

    this.peers = new Map();
    this.localStream = null;
    this.cameraTrack = null;
    this.screenTrack = null;

    this.audioEnabled = true;
    this.videoEnabled = true;
    this.screenSharing = false;

    this.statsTimer = null;
    this.audioCtx = null;
    this.analyser = null;
    this.speakingRaf = 0;
    this.speakingThreshold = 18;
    this.lastSpeaking = false;
  }

  /* ---------------- local media ---------------- */

  async startLocal(opts = {}) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: opts.videoDeviceId
        ? { deviceId: { exact: opts.videoDeviceId } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.cameraTrack = this.localStream.getVideoTracks()[0] || null;

    if (opts.startMuted) {
      this.localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      this.audioEnabled = false;
    }
    if (opts.startCamOff) {
      this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
      this.videoEnabled = false;
    }

    this._startSpeakingDetection();
    return this.localStream;
  }

  _startSpeakingDetection() {
    try {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (!audioTrack) return;
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = sum / data.length;
        const speaking = level > this.speakingThreshold && this.audioEnabled;
        if (speaking !== this.lastSpeaking) {
          this.lastSpeaking = speaking;
          this.onSpeaking('local', speaking);
        }
        this.speakingRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* ignore */ }
  }

  toggleAudio() {
    this.audioEnabled = !this.audioEnabled;
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = this.audioEnabled; });
    return { audio: this.audioEnabled, video: this.videoEnabled, screen: this.screenSharing };
  }

  toggleVideo() {
    this.videoEnabled = !this.videoEnabled;
    this.localStream.getVideoTracks().forEach((t) => { t.enabled = this.videoEnabled; });
    return { audio: this.audioEnabled, video: this.videoEnabled, screen: this.screenSharing };
  }

  forceMute() {
    if (this.audioEnabled) {
      this.audioEnabled = false;
      this.localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
    return { audio: false, video: this.videoEnabled, screen: this.screenSharing };
  }

  /* ---------------- peers ---------------- */

  addPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);

    const polite = this.socket.id < peerId;
    const pc = new RTCPeerConnection(ICE_CONFIG);

    const rec = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      restarted: false,
      senders: {},
      stats: { bitrate: 0, rtt: 0, quality: 'good', packetsLost: 0 },
    };
    this.peers.set(peerId, rec);

    this.localStream.getTracks().forEach((track) => {
      rec.senders[track.kind] = pc.addTrack(track, this.localStream);
    });

    if (this.screenTrack && rec.senders.video) {
      rec.senders.video.replaceTrack(this.screenTrack).catch(() => {});
    }

    pc.onnegotiationneeded = async () => {
      try {
        rec.makingOffer = true;
        await pc.setLocalDescription();
        this.socket.emit('signal', { to: peerId, data: { description: pc.localDescription } });
      } catch (e) { console.warn(e); }
      finally { rec.makingOffer = false; }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('signal', { to: peerId, data: { candidate } });
    };

    pc.ontrack = ({ streams, track }) => {
      const stream = streams && streams[0];
      if (stream) this.onRemoteStream(peerId, stream, track);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.onPeerState(peerId, state);
      if (state === 'failed') {
        if (!rec.restarted) {
          rec.restarted = true;
          try { pc.restartIce(); } catch { /* ignore */ }
        } else {
          this.removePeer(peerId);
        }
      } else if (state === 'closed') {
        this.removePeer(peerId);
      }
    };

    // Speaking detection on remote audio
    pc.ontrack = (() => {
      const originalHandler = pc.ontrack;
      return (ev) => {
        originalHandler && originalHandler(ev);
        const track = ev.track;
        if (track.kind === 'audio') {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const src = ctx.createMediaStreamSource(new MediaStream([track]));
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            src.connect(an);
            const data = new Uint8Array(an.frequencyBinCount);
            let last = false;
            const tick = () => {
              an.getByteFrequencyData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) sum += data[i];
              const speaking = sum / data.length > this.speakingThreshold;
              if (speaking !== last) {
                last = speaking;
                this.onSpeaking(peerId, speaking);
              }
              requestAnimationFrame(tick);
            };
            tick();
          } catch { /* ignore */ }
        }
      };
    })();

    this._startStatsPolling();
    return rec;
  }

  _startStatsPolling() {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(async () => {
      for (const [peerId, rec] of this.peers) {
        try {
          const stats = await rec.pc.getStats();
          let inboundVideo = null;
          let inboundAudio = null;
          let candidatePair = null;

          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') inboundVideo = report;
            if (report.type === 'inbound-rtp' && report.kind === 'audio') inboundAudio = report;
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              candidatePair = report;
            }
          });

          const prev = rec.stats;
          const now = Date.now();
          const dt = prev._lastUpdate ? now - prev._lastUpdate : 0;

          if (inboundVideo && dt > 0 && prev._lastBytes !== undefined) {
            const bytes = inboundVideo.bytesReceived || 0;
            const bitrate = ((bytes - prev._lastBytes) * 8) / (dt / 1000);
            rec.stats.bitrate = Math.max(0, Math.round(bitrate / 1000)); // kbps
            rec.stats._lastBytes = bytes;
          } else if (inboundVideo) {
            rec.stats._lastBytes = inboundVideo.bytesReceived || 0;
          }

          rec.stats._lastUpdate = now;
          if (candidatePair && candidatePair.currentRoundTripTime !== undefined) {
            rec.stats.rtt = Math.round(candidatePair.currentRoundTripTime * 1000);
          }
          if (inboundVideo && inboundVideo.packetsLost !== undefined) {
            rec.stats.packetsLost = inboundVideo.packetsLost;
          }

          const lossRatio = inboundVideo && inboundVideo.packetsReceived
            ? inboundVideo.packetsLost / (inboundVideo.packetsReceived + inboundVideo.packetsLost)
            : 0;

          let quality = 'good';
          if (rec.stats.rtt > 300 || lossRatio > 0.08 || rec.stats.bitrate < 100) quality = 'bad';
          else if (rec.stats.rtt > 150 || lossRatio > 0.03 || rec.stats.bitrate < 400) quality = 'mid';

          rec.stats.quality = quality;
          this.onPeerStats(peerId, { ...rec.stats });
        } catch { /* ignore */ }
      }
    }, 2000);
  }

  async handleSignal(from, data) {
    let rec = this.peers.get(from);
    if (!rec) rec = this.addPeer(from);
    const pc = rec.pc;

    try {
      if (data.description) {
        const offerCollision =
          data.description.type === 'offer' &&
          (rec.makingOffer || pc.signalingState !== 'stable');

        rec.ignoreOffer = !rec.polite && offerCollision;
        if (rec.ignoreOffer) return;

        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.socket.emit('signal', { to: from, data: { description: pc.localDescription } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (e) { if (!rec.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.warn('[rtc]', e); }
  }

  removePeer(peerId) {
    const rec = this.peers.get(peerId);
    if (!rec) return;
    this.peers.delete(peerId);
    try { rec.pc.close(); } catch { /* ignore */ }
    this.onPeerLeft(peerId);
  }

  /* ---------------- screen sharing ---------------- */

  async startScreenShare() {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 20, max: 30 }, width: { max: 1920 } },
      audio: false,
    });
    this.screenTrack = display.getVideoTracks()[0];
    this.screenSharing = true;

    for (const rec of this.peers.values()) {
      const sender = rec.senders.video;
      if (sender) {
        try { await sender.replaceTrack(this.screenTrack); } catch { /* ignore */ }
      }
    }
    this.screenTrack.addEventListener('ended', () => this.stopScreenShare());
    return this.screenTrack;
  }

  async stopScreenShare() {
    if (!this.screenTrack) return;
    try { this.screenTrack.stop(); } catch { /* ignore */ }
    this.screenTrack = null;
    this.screenSharing = false;
    for (const rec of this.peers.values()) {
      const sender = rec.senders.video;
      if (sender && this.cameraTrack) {
        try { await sender.replaceTrack(this.cameraTrack); } catch { /* ignore */ }
      }
    }
  }

  destroy() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.speakingRaf) cancelAnimationFrame(this.speakingRaf);
    if (this.audioCtx) { try { this.audioCtx.close(); } catch { /* ignore */ } }
    for (const [peerId, rec] of [...this.peers]) {
      this.peers.delete(peerId);
      try { rec.pc.close(); } catch { /* ignore */ }
    }
    if (this.screenTrack) { try { this.screenTrack.stop(); } catch { /* ignore */ } }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    }
  }
}