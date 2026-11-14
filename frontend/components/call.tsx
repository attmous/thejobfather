"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { LiveCall } from "../lib/live-call";
import type { Connection, Speaker } from "../lib/live-call";

type Line = {
  id: number;
  speaker: Speaker;
  text: string;
  status: "streaming" | "complete" | "incomplete";
};

const speakerLabels = { agent: "JobFather", user: "You" };

export function Call({ active, jobVersion, topic, onAnswer }: {
  active: boolean;
  jobVersion: number;
  topic: string | undefined;
  onAnswer: (text: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [muted, setMuted] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<LiveCall | null>(null);
  const lastTopic = useRef(topic);
  const video = useRef<HTMLVideoElement>(null);
  const transcriptLog = useRef<HTMLOListElement>(null);
  const nextLineId = useRef(0);
  const liveLines = useRef<Partial<Record<Speaker, number>>>({});
  const followTranscript = useRef(true);

  useEffect(() => {
    if (!active) controller.current?.end();
  }, [active]);

  useEffect(() => {
    if (lastTopic.current === topic) return;
    lastTopic.current = topic;
    controller.current?.moveToTopic(topic);
  }, [topic]);

  useEffect(() => () => controller.current?.end(undefined, false), []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const log = transcriptLog.current;
    if (log && active && followTranscript.current) log.scrollTop = log.scrollHeight;
  }, [active, transcript]);

  function start() {
    if (controller.current) return;
    setError("");
    setNotice("");
    setMuted(false);
    setAnnouncement("");
    followTranscript.current = true;
    setStatus("connecting");
    const call = new LiveCall({
      ready: () => {
        setStatus("live");
        if (lastTopic.current !== topic) call.moveToTopic(lastTopic.current);
      },
      sharing: setStream,
      notice: setNotice,
      caption: (speaker, text, final) => {
        if (!text.trim()) return;
        const pendingId = liveLines.current[speaker];
        const id = pendingId ?? nextLineId.current++;
        const line: Line = { id, speaker, text, status: final ? "complete" : "streaming" };
        setTranscript(lines => pendingId === undefined
          ? [...lines, line]
          : lines.map(previous => previous.id === id ? line : previous));

        if (final) {
          delete liveLines.current[speaker];
          setAnnouncement(`${speakerLabels[speaker]}: ${text}`);
          if (speaker === "user") onAnswer(text);
        } else {
          liveLines.current[speaker] = id;
        }
      },
      ended: message => {
        controller.current = null;
        liveLines.current = {};
        setTranscript(lines => lines.map(line => line.status === "streaming"
          ? { ...line, status: "incomplete" }
          : line));
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
      <div className="call-content" data-sharing={!!stream}>
        {stream && <video className="call-screen" ref={video} muted autoPlay playsInline aria-label="Shared screen preview" />}
        <section className="call-transcript" aria-labelledby="call-transcript-title">
          <h3 id="call-transcript-title">Live transcript</h3>
          {transcript.length ? <ol className="call-log" ref={transcriptLog} aria-labelledby="call-transcript-title" tabIndex={0}
            onScroll={event => {
              const log = event.currentTarget;
              followTranscript.current = log.scrollHeight - log.scrollTop - log.clientHeight <= 32;
            }}>
            {transcript.map(line => <li key={line.id} className="call-line" data-speaker={line.speaker}>
              <div className="call-line-heading">
                <span className="call-speaker">{speakerLabels[line.speaker]}</span>
                {line.status !== "complete" && <span className="call-line-status">
                  {line.status === "streaming" ? "Speaking…" : "Incomplete"}
                </span>}
              </div>
              <p>{line.text}</p>
            </li>)}
          </ol> : <p className="hint call-transcript-empty">{status === "live"
            ? "Waiting for the conversation to begin…"
            : "You’ll see both sides of the conversation here once the call starts."}</p>}
          <div className="call-transcript-announcement" role="status">{announcement}</div>
        </section>
      </div>
    </div>
  );
}
