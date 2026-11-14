"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "../lib/api";
import type { Profile } from "../lib/profile";
import type { ConfirmedJob } from "./job";
import { Call } from "./call";
import { SessionFit } from "./fit";

type Fact = { id: string; text: string; evidence: string; source: "chat" | "call"; added: boolean };
const topics = ["Job requirements", "Personal contribution", "Impact and scale", "Project to highlight", "Cover letter angle"];
type Chat = {
  job_version: number;
  revision: number;
  topics: Record<string, "covered" | "skipped">;
  messages: { speaker: "agent" | "user"; text: string; topic: string | null }[];
  facts: Fact[];
};
export type InterviewProgress = "not-started" | "in-progress" | "finished";
export type FactApproval = { session: Chat; profile: Profile; previous_profile_version: number };

function request<T>(path: string, method: string, body: object) {
  return apiRequest<T>("/api/session" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function Session({ job, profileVersion, active, onApprove, onCreateDrafts, onProgress }: {
  job: ConfirmedJob;
  profileVersion: number;
  active: boolean;
  onApprove: (approval: FactApproval) => void;
  onCreateDrafts: () => void;
  onProgress: (jobVersion: number, progress: InterviewProgress) => void;
}) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [mode, setMode] = useState<"chat" | "call">("chat");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const lastMessage = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busyRef = useRef(false);
  const factQueue = useRef(Promise.resolve());
  const source = { job_version: job.version };
  const currentTopic = topics.find(topic => !chat?.topics[topic]);
  const currentTopicIndex = currentTopic ? topics.indexOf(currentTopic) : -1;
  const followingTopic = currentTopic ? topics.slice(currentTopicIndex + 1).find(topic => !chat?.topics[topic]) : undefined;
  const lastPrompt = chat?.messages.at(-1);
  const chatReady = !!lastPrompt && (lastPrompt.topic ?? undefined) === currentTopic;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Chat>("/api/session?job_version=" + job.version, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) {
          setChat(current => current && current.revision > result.revision ? current : result);
        }
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [active, job.version]);

  useEffect(() => {
    if (!chat) return;
    const started = chat.revision > 0;
    onProgress(job.version, !currentTopic ? "finished" : started ? "in-progress" : "not-started");
  }, [chat, currentTopic, job.version, onProgress]);

  async function update<T>(label: string, action: () => Promise<T>, apply: (result: T) => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    try {
      apply(await action());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t update the session.");
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function start() {
    void update(lastPrompt ? "Loading the current topic…" : "Starting chat…", () => request<Chat>("/start", "POST", source), result => {
      setChat(result);
      requestAnimationFrame(() => input.current?.focus());
    });
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!answer.trim() || !chat || !chatReady) return;
    void update("JobFather is replying…", () => request<Chat>("/chat", "POST", {
      ...source, revision: chat.revision, answer: answer.trim(),
    }), result => {
      setChat(result);
      setAnswer("");
      requestAnimationFrame(() => {
        lastMessage.current?.scrollIntoView({ block: "nearest" });
        input.current?.focus({ preventScroll: true });
      });
    });
  }

  function updateTopic(status: "covered" | "skipped") {
    if (!chat || !currentTopic) return;
    void update("Updating interview…", () => request<Chat>("/topics", "POST", {
      ...source, revision: chat.revision, topic: currentTopic, status, mode,
    }), result => {
      setChat(current => current && current.revision > result.revision ? current : result);
      if (mode === "chat") {
        setAnswer("");
        requestAnimationFrame(() => lastMessage.current?.scrollIntoView({ block: "nearest" }));
      }
    });
  }

  function editFact(event: FormEvent<HTMLFormElement>, fact: Fact) {
    event.preventDefault();
    if (!editText.trim()) return;
    void update("Saving edit…", () => request<Chat>("/facts/" + fact.id, "PATCH", {
      ...source, text: editText.trim(),
    }), result => {
      setChat(result);
      setEditing(null);
    });
  }

  function addFact(fact: Fact) {
    void update("Adding fact…", () => request<FactApproval>("/facts/" + fact.id + "/add", "POST", {
      ...source, text: fact.text,
    }), result => {
      setChat(result.session);
      onApprove(result);
    });
  }

  function captureCallAnswer(answer: string) {
    const turn = { ...source, turn_id: crypto.randomUUID(), answer: answer.slice(0, 4000) };
    factQueue.current = factQueue.current.then(async () => {
      try {
        const result = await request<Chat>("/call/facts", "POST", turn);
        setChat(current => current && current.revision > result.revision ? current : result);
      } catch {
        setError("Couldn’t check a call answer for facts.");
      }
    });
  }

  return (
    <div className="session" hidden={!active}>
      <div className="session-job">
        <h2>{job.details.role}</h2>
        <p className="hint">{job.details.company}</p>
      </div>
      {active && <SessionFit jobVersion={job.version} profileVersion={profileVersion} />}
      <div className="session-modes" role="group" aria-label="Session mode">
        <button type="button" className="button" aria-pressed={mode === "chat"} onClick={() => setMode("chat")}>Chat</button>
        <button type="button" className="button session-call-button" aria-pressed={mode === "call"} onClick={() => setMode("call")}>Call</button>
      </div>
      <section className="panel pane workflow-stack" aria-labelledby="interview-topics">
        <div className="workflow-row">
          <h2 id="interview-topics">Interview topics</h2>
          <span className="hint">{topics.filter(topic => chat?.topics[topic] === "covered").length} of {topics.length} covered</span>
        </div>
        <ol className="interview-topics">{topics.map(topic => {
          const status = chat?.topics[topic];
          return <li key={topic} aria-current={topic === currentTopic ? "step" : undefined} data-status={status}>
            <span>{topic}</span>
            <small>{status === "covered" ? "Covered" : status === "skipped" ? "Skipped" : topic === currentTopic ? "In progress" : "Upcoming"}</small>
          </li>;
        })}</ol>
        {chat && currentTopic && <div className="workflow-row interview-next">
          <p className="hint" aria-live="polite">{followingTopic ? `Up next: ${followingTopic}` : "You’re on the last topic."}</p>
          <div className="actions">
            {mode === "call" && <button className="button" type="button" disabled={!!busy} onClick={() => updateTopic("covered")}>Mark covered</button>}
            <button className="button" type="button" disabled={!!busy} onClick={() => updateTopic("skipped")}>
              {followingTopic ? "Skip to next topic" : "Skip last topic"}
            </button>
          </div>
        </div>}
      </section>
      <Call active={active && mode === "call"} jobVersion={job.version} topic={currentTopic} onAnswer={captureCallAnswer} />
      {mode === "chat" && (chat?.messages.length ? <section className="panel session-chat" aria-label="Chat with JobFather">
        <div className="session-messages" role="log" aria-label="Messages">
          {chat.messages.map((message, index) => (
            <div className="session-message" data-speaker={message.speaker} key={index}
              ref={index === chat.messages.length - 1 ? lastMessage : undefined}>
              <span>{message.speaker === "agent" ? "JobFather" : "You"}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        {chatReady ? <form className="session-composer" onSubmit={send}>
          <div>
            <label htmlFor="session-answer">Your answer</label>
            <textarea id="session-answer" ref={input} rows={2} maxLength={4000} value={answer} required
              readOnly={!!busy} onChange={event => setAnswer(event.target.value)} />
          </div>
          <button className="button primary" type="submit" disabled={!!busy || !answer.trim()}>Send</button>
        </form> : <div className="pane">
          <button className="button primary" type="button" disabled={!!busy} onClick={start}>Continue chat</button>
        </div>}
      </section> : <div className="panel standalone">
        <p className="hint">Talk about work that’s relevant to this job.</p>
        <button className="button primary" type="button" onClick={start} disabled={!!busy}>Start chat</button>
      </div>)}
      {!!busy && <p className="hint" role="status">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <section className="panel session-facts" aria-labelledby="captured-facts-heading">
        <header><h2 id="captured-facts-heading">Captured facts</h2></header>
        {chat?.facts.length ? <ul className="fact-list">
          {chat.facts.map(fact => <li key={fact.id}>
            {editing === fact.id ? <form className="fact-editor" onSubmit={event => editFact(event, fact)}>
              <label htmlFor="edit-fact">Edit fact</label>
              <textarea id="edit-fact" autoFocus rows={2} maxLength={600} value={editText} required
                readOnly={!!busy} onChange={event => setEditText(event.target.value)} />
              <div className="actions">
                <button className="button" type="submit" disabled={!!busy || !editText.trim()}>Save edit</button>
                <button className="button quiet" type="button" disabled={!!busy} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form> : <div className="fact-row">
              <div className="fact-copy">
                <p>{fact.text}</p>
                <details>
                  <summary>{fact.source === "chat" ? "From chat" : "From call"}</summary>
                  <blockquote>{fact.evidence}</blockquote>
                </details>
              </div>
              {fact.added ? <span className="fact-added">Added to profile</span> : <div className="fact-actions">
                <button className="button" type="button" disabled={!!busy} onClick={() => {
                  setEditText(fact.text);
                  setEditing(fact.id);
                }}>Edit</button>
                <button className="button" type="button" disabled={!!busy} onClick={() => addFact(fact)}>Add to profile</button>
              </div>}
            </div>}
          </li>)}
        </ul> : <p className="hint fact-empty">No facts yet.</p>}
      </section>
      <div className="form-footer session-next">
        {chat && !currentTopic
          ? <p className="hint success" role="status">Interview topics finished.</p>
          : <p className="hint">Drafts use the facts saved to your profile.</p>}
        <button className="button primary" type="button" disabled={!!busy || !!editing} onClick={onCreateDrafts}>Create drafts</button>
      </div>
    </div>
  );
}
