"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { LiveCall } from "../lib/live-call";
import type { Connection, Speaker } from "../lib/live-call";

type Line = { speaker: Speaker; text: string };

export function Call({ active, jobVersion, onAnswer }: {
  active: boolean;
  jobVersion: number;
  onAnswer: (text: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [captions, setCaptions] = useState<Record<Speaker, string>>({ agent: "", user: "" });
  const [muted, setMuted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<LiveCall | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const transcriptLog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) controller.current?.end();
  }, [active]);

  useEffect(() => () => controller.current?.end(undefined, false), []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const log = transcriptLog.current;
    if (log && active) log.scrollTop = log.scrollHeight;
  }, [active, transcript, captions]);

  function start() {
    if (controller.current) return;
    setError("");
    setNotice("");
    setMuted(false);
    setStatus("connecting");
    const call = new LiveCall({
      ready: () => setStatus("live"),
      sharing: setStream,
      notice: setNotice,
      caption: (speaker, text, final) => {
        setCaptions(current => ({ ...current, [speaker]: final ? "" : text }));
        if (final) {
          setTranscript(lines => [...lines, { speaker, text }]);
          if (speaker === "user") onAnswer(text);
        }
      },
      ended: message => {
        controller.current = null;
        setStatus("idle");
        setNotice("");
        if (message) setError(message);
      },
    });
    controller.current = call;
    void call.start(() => apiRequest<Connection>("/api/session/call/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_version: jobVersion }),
    }));
  }

  async function toggleSharing() {
    if (stream) {
      controller.current?.stopSharing();
      return;
    }
    const call = controller.current;
    if (!call) return;
    setError("");
    try {
      await call.share();
    } catch (failure) {
      if (controller.current !== call) return;
      if (failure instanceof DOMException && failure.name === "NotAllowedError") return;
      setError(failure instanceof Error ? failure.message : "Couldn’t share your screen.");
    }
  }

  return (
    <div className="panel call" hidden={!active} aria-label="Voice call">
      <div className="call-main">
        <h2>Call with JobFather</h2>
        <p className="hint" role="status">{status === "live"
          ? stream ? "Live · Screen sharing" : "Live"
          : status === "connecting" ? "Connecting…" : "Use your microphone to talk. Screen sharing is optional."}</p>
        {stream && <video className="call-screen" ref={video} muted autoPlay playsInline aria-label="Shared screen preview" />}
        <div className="actions">
          {status === "idle" ? <button className="button primary" type="button" onClick={start}>
            {transcript.length ? "Start another call" : "Start call"}
          </button> : <>
            {status === "live" && <>
              <button className="button" type="button" onClick={() => {
                controller.current?.setMuted(!muted);
                setMuted(!muted);
              }}>{muted ? "Unmute" : "Mute"}</button>
              <button className="button" type="button" onClick={() => void toggleSharing()}>
                {stream ? "Stop sharing" : "Share screen"}
              </button>
            </>}
            <button className="button" type="button" onClick={() => controller.current?.end()}>End call</button>
          </>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="hint" role="status">{notice}</p>}
      </div>
      {(status !== "idle" || transcript.length > 0) && <section className="call-transcript" aria-labelledby="call-transcript-title">
        <h3 id="call-transcript-title">Transcript</h3>
        <div className="call-log" ref={transcriptLog}>
          <div role="log" aria-label="Completed captions">
            {transcript.map((line, index) => <TranscriptLine key={index} {...line} />)}
          </div>
          {(["user", "agent"] as const).map(speaker => captions[speaker]
            && <TranscriptLine key={speaker} speaker={speaker} text={captions[speaker]} />)}
          {!transcript.length && !captions.user && !captions.agent && <p className="hint">Captions appear here as you talk.</p>}
        </div>
      </section>}
    </div>
  );
}

function TranscriptLine({ speaker, text }: Line) {
  return <div className="call-line">
    <span>{speaker === "agent" ? "JobFather" : "You"}</span>
    <p>{text}</p>
  </div>;
}
