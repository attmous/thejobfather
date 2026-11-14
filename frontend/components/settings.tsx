"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "../lib/api";

type Provider = "gemini" | "openai" | "anthropic";
type TextSettings = { provider: Provider; model: string; configured: boolean };

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
  const [textSettings, setTextSettings] = useState<TextSettings | null>(null);
  const [textProvider, setTextProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("");
  const [textKey, setTextKey] = useState("");
  const [textBusy, setTextBusy] = useState(false);
  const [textNotice, setTextNotice] = useState("");
  const [textError, setTextError] = useState(false);

  async function updateText(options?: RequestInit) {
    setTextBusy(true);
    setTextNotice("");
    setTextError(false);
    try {
      const saved = await apiRequest<TextSettings>("/api/settings/text", options);
      setTextSettings(saved);
      setTextProvider(saved.provider);
      setModel(saved.provider === "gemini" ? "" : saved.model);
      setTextKey("");
      if (options) setTextNotice("Text model saved.");
    } catch (failure) {
      setTextNotice((failure as Error).message);
      setTextError(true);
    } finally { setTextBusy(false); }
  }

  function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (textBusy) return;
    void updateText({ method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: textProvider, model, api_key: textKey.trim() || null }),
    });
  }

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
    void updateText();
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
        onClose={() => { setKey(""); setTextKey(""); setError(""); setMessage(""); }}
        onCancel={event => { if (busy || textBusy) event.preventDefault(); }}>
        <header className="settings-heading">
          <h2 id="settings-title">Settings</h2>
          <button className="button quiet" type="button" disabled={busy || textBusy}
            onClick={() => dialog.current?.close()}>Close</button>
        </header>
        <section className="settings-body" aria-labelledby="gemini-heading">
          <div className="settings-provider">
            <h3 id="gemini-heading">Gemini</h3>
            {status && <span className="settings-status" data-source={status.source}>
              {status.source === "app" ? "Key saved" : status.source === "environment" ? "Server key" : "No key"}
            </span>}
          </div>
          <p className="hint" id="gemini-help">Used for Gemini Live calls, URL Context, and the default text model.</p>
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
        <section className="settings-body text-model-settings" aria-labelledby="text-model-heading">
          <h3 id="text-model-heading">Text model</h3>
          <p className="hint">Used for text imports, scoring, chat, and drafts. URL Context for other public job boards uses Gemini.</p>
          <form className="workflow-stack" onSubmit={saveText}>
            <div><label htmlFor="text-provider">Provider</label><select id="text-provider" disabled={textBusy} value={textProvider}
              onChange={event => {
                const next = event.target.value as Provider;
                setTextProvider(next); setModel(textSettings?.provider === next && next !== "gemini" ? textSettings.model : "");
                setTextKey(""); setTextNotice("");
              }}>
              <option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option>
            </select></div>
            {textProvider !== "gemini" && <>
              <div><label htmlFor="text-provider-model">Model ID</label><input id="text-provider-model" required maxLength={128} disabled={textBusy}
                value={model} onChange={event => setModel(event.target.value)} /></div>
              <div><label htmlFor="text-provider-key">{textSettings?.provider === textProvider && textSettings.configured ? "New API key (optional)" : "Provider API key"}</label>
                <input id="text-provider-key" type="password" maxLength={512} autoComplete="off" disabled={textBusy}
                  value={textKey} onChange={event => setTextKey(event.target.value)} /></div>
            </>}
            <div className="form-footer"><p className={textError ? "error" : "hint"} role={textError ? "alert" : "status"}>{textBusy ? "Working…" : textNotice}</p>
              <button className="button" type="submit" disabled={textBusy}>Save text model</button></div>
          </form>
        </section>
      </dialog>
    </>
  );
}
