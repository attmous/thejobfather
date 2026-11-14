export type Connection = { token: string; setup: object };
export type Speaker = "agent" | "user";

type Caption = { text?: string; finished?: boolean };
type LiveMessage = {
  setupComplete?: object;
  goAway?: object;
  error?: object;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: Caption;
    outputTranscription?: Caption;
    modelTurn?: { parts?: { thought?: boolean; inlineData?: { mimeType: string; data: string } }[] };
  };
};

const endpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

function base64(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export class LiveCall {
  private socket?: WebSocket;
  private context?: AudioContext;
  private mic?: MediaStream;
  private processor?: AudioWorkletNode;
  private screen?: MediaStream;
  private screenTimer?: number;
  private timeout?: number;
  private stopped = false;
  private ready = false;
  private muted = false;
  private audioEnd = 0;
  private playback = new Set<AudioBufferSourceNode>();
  private captions: Record<Speaker, string> = { user: "", agent: "" };
  private queue = Promise.resolve();
  private screenRequest = false;

  constructor(private events: {
    ready: () => void;
    caption: (speaker: Speaker, text: string, final: boolean) => void;
    sharing: (stream: MediaStream | null) => void;
    notice: (message: string) => void;
    ended: (message?: string) => void;
  }) {}

  async start(authorize: () => Promise<Connection>) {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error("Microphone access requires localhost or HTTPS in a supported browser.");
      }
      this.context = new AudioContext();
      const resumed = this.context.resume();
      void resumed.catch(() => {});
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch {
        await resumed.catch(() => {});
        throw new Error("Allow microphone access to start a call.");
      }
      if (this.stopped) {
        this.mic.getTracks().forEach(track => track.stop());
        return;
      }
      const context = this.context;
      await resumed;
      await context.audioWorklet.addModule("/live-microphone.js");
      if (this.stopped) return;
      const { token, setup } = await authorize();
      if (this.stopped) return;

      const socket = this.socket = new WebSocket(endpoint + "?access_token=" + encodeURIComponent(token));
      socket.binaryType = "arraybuffer";
      socket.onopen = () => this.send({ setup });
      socket.onmessage = event => {
        this.queue = this.queue.then(() => this.receive(event.data)).catch(() => {
          this.end("The call couldn’t read the reply. Start a new call.");
        });
      };
      socket.onerror = () => this.end("Couldn’t connect to Gemini Live. Try again.");
      socket.onclose = () => this.end(this.ready ? "The call disconnected. You can start again." : "Gemini Live couldn’t start. Try again.");
      this.timeout = window.setTimeout(() => this.end("The call took too long to connect. Try again."), 12000);
      this.mic.getAudioTracks()[0]?.addEventListener("ended", () => this.end("Microphone access ended."));
    } catch (error) {
      this.end(error instanceof Error ? error.message : "Couldn’t start the call.");
    }
  }

  moveToTopic(topic: string | undefined) {
    if (!this.ready) return;
    const text = topic
      ? `The app has moved to the interview topic "${topic}". Ask one short question about it.`
      : "The app has reached the end of the interview topics. Briefly wrap up the interview.";
    this.send({ realtimeInput: { text } });
  }

  private send(message: object) {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(data: ArrayBuffer | string) {
    if (this.stopped) return;
    const packet: LiveMessage = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    if (packet.setupComplete && !this.ready) {
      if (!this.context || !this.mic) return;
      clearTimeout(this.timeout);
      const processor = this.processor = new AudioWorkletNode(this.context, "live-microphone");
      processor.port.onmessage = event => {
        if (!this.muted && (this.socket?.bufferedAmount ?? Infinity) < 256_000) {
          this.send({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64(event.data) } } });
        }
      };
      // The worklet output is silent. Its connection keeps it running.
      this.context.createMediaStreamSource(this.mic).connect(processor).connect(this.context.destination);
      this.ready = true;
      this.send({ realtimeInput: { text: "Start the call with one short question about my relevant experience." } });
      this.events.ready();
    }
    if (packet.error) return this.end("Gemini Live ended the call. Try again.");
    const content = packet.serverContent;
    if (content) {
      this.receiveCaption("user", content.inputTranscription);
      this.receiveCaption("agent", content.outputTranscription);
      if (content.interrupted) {
        this.stopPlayback();
        this.finalize("agent");
      } else {
        for (const part of content.modelTurn?.parts ?? []) {
          if (!part.thought && part.inlineData?.mimeType.startsWith("audio/pcm")) {
            this.play(part.inlineData.data, part.inlineData.mimeType);
          }
        }
      }
      if (content.turnComplete) {
        if (!content.interrupted) this.finalize("user");
        this.finalize("agent");
      }
    }
    if (packet.goAway) this.events.notice("This connection is about to close. You can start another call to continue.");
  }

  private receiveCaption(speaker: Speaker, caption?: Caption) {
    if (!caption) return;
    if (caption.text) {
      const prior = this.captions[speaker];
      this.captions[speaker] = prior && caption.text.startsWith(prior) ? caption.text : prior + caption.text;
      this.events.caption(speaker, this.captions[speaker], false);
    }
    if (caption.finished) this.finalize(speaker);
  }

  private finalize(speaker: Speaker) {
    const text = this.captions[speaker].trim();
    this.captions[speaker] = "";
    if (text) this.events.caption(speaker, text, true);
  }

  private play(encoded: string, mime: string) {
    if (!this.context) return;
    const binary = atob(encoded);
    const frames = Math.floor(binary.length / 2);
    if (!frames) return;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    const buffer = this.context.createBuffer(1, frames, rate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      samples[i] = (value < 32768 ? value : value - 65536) / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.015, this.audioEnd);
    this.playback.add(source);
    source.onended = () => { this.playback.delete(source); source.disconnect(); };
    source.start(start);
    this.audioEnd = start + buffer.duration;
  }

  private stopPlayback() {
    for (const source of this.playback) source.stop();
    this.playback.clear();
    this.audioEnd = 0;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.processor?.port.postMessage(!muted);
    this.mic?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    if (muted) this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  async share() {
    if (!this.ready || this.stopped || this.screen || this.screenRequest) return;
    if (!navigator.mediaDevices.getDisplayMedia) throw new Error("Screen sharing isn’t available in this browser.");
    this.screenRequest = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 1, max: 1 } }, audio: false,
      });
      if (this.stopped) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.screen = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => this.stopSharing());
      this.events.sharing(stream);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        if (this.screen === stream) this.stopSharing();
        throw new Error("Couldn’t read the shared screen.");
      }
      if (this.screen !== stream) return;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      this.screenTimer = window.setInterval(() => {
        if (this.screen !== stream || !video.videoWidth || !context || (this.socket?.bufferedAmount ?? Infinity) > 128_000) return;
        const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        this.send({ realtimeInput: { video: { mimeType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.7).split(",")[1] } } });
      }, 1000);
    } finally {
      this.screenRequest = false;
    }
  }

  stopSharing() {
    if (!this.screen) return;
    clearInterval(this.screenTimer);
    this.screen.getTracks().forEach(track => track.stop());
    this.screen = undefined;
    this.events.sharing(null);
  }

  end(message?: string, notify = true) {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timeout);
    this.stopSharing();
    this.stopPlayback();
    this.mic?.getTracks().forEach(track => track.stop());
    this.processor?.disconnect();
    this.processor?.port.close();
    if (this.socket) {
      this.socket.onopen = this.socket.onclose = this.socket.onerror = this.socket.onmessage = null;
      this.socket.close();
    }
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    if (notify) {
      this.finalize("agent");
      this.events.ended(message);
    }
  }
}
