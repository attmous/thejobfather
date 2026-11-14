"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

type KeyStatus = { source: "app" | "environment" | "none" };
const endpoint = "/api/settings/gemini";

async function requestSettings(options?: RequestInit): Promise<KeyStatus> {
  const response = await fetch(endpoint, { ...options, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(response.status === 422 ? "Enter a Gemini API key." : "Couldn’t update Settings. Try again.");
  }
  if (body?.source !== "app" && body?.source !== "environment" && body?.source !== "none") {
    throw new Error("Couldn’t load Settings. Try again.");
  }
  return body;
}

export function Settings() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function update(options?: RequestInit, success = "") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setStatus(await requestSettings(options));
      setKey("");
      setMessage(success);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t reach the app. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function open() {
    setStatus(null);
    dialog.current?.showModal();
    void update();
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void update({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key.trim() }),
    }, "Gemini key saved.");
  }

  return (
    <>
      <button className="button settings-trigger" type="button" aria-haspopup="dialog" onClick={open}>Settings</button>
      <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title"
        onClose={() => { setKey(""); setError(""); setMessage(""); }}
        onCancel={event => { if (busy) event.preventDefault(); }}>
        <header className="settings-heading">
          <h2 id="settings-title">Settings</h2>
          <button className="button quiet" type="button" disabled={busy}
            onClick={() => dialog.current?.close()}>Close</button>
        </header>
        <section className="settings-body" aria-labelledby="gemini-heading">
          <div className="settings-provider">
            <h3 id="gemini-heading">Gemini</h3>
            {status && <span className="settings-status" data-source={status.source}>
              {status.source === "app" ? "Key saved" : status.source === "environment" ? "Server key" : "No key"}
            </span>}
          </div>
          <p className="hint" id="gemini-help">One Gemini API key for résumé and job imports, fit scores, chat, drafts, and voice calls.</p>
          <form onSubmit={save}>
            <label htmlFor="gemini-key">{status?.source === "app" ? "New API key" : "API key"}</label>
            <input id="gemini-key" type="password" value={key} required maxLength={256}
              autoComplete="off" spellCheck={false} disabled={busy} aria-describedby="gemini-help"
              onChange={event => { setKey(event.target.value); setError(""); setMessage(""); }} />
            <a className="settings-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Get a Gemini API key</a>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="form-footer settings-actions">
              {status?.source === "app" && <button className="button quiet" type="button" disabled={busy}
                onClick={() => void update({ method: "DELETE" }, "Saved key removed.")}>Remove key</button>}
              <p className="hint" role="status">{busy ? "Working…" : message}</p>
              <button className="button primary" type="submit" disabled={busy || !key.trim()}>Save key</button>
            </div>
          </form>
        </section>
      </dialog>
    </>
  );
}
