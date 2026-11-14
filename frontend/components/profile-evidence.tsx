"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { profileRequest } from "../lib/profile";
import type { ApprovedEvidence, Profile } from "../lib/profile";

type Repo = { url: string; label: string; description: string; languages: string[]; readme: string };

export function ProfileEvidence({ profile, disabled, onApprove }: {
  profile: Profile; disabled: boolean; onApprove: (profile: Profile) => void;
}) {
  const [mode, setMode] = useState<ApprovedEvidence["kind"] | null>(null);
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState<Repo | null>(null);
  const [label, setLabel] = useState("LinkedIn profile");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function open(source: ApprovedEvidence["kind"]) {
    setMode(source);
    setRepo(null);
    setUrl("");
    setLabel("LinkedIn profile");
    setText("");
    setError("");
    setMessage("");
  }

  async function run(update: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await update(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    void run(async () => {
      const result = await profileRequest<Repo>("/evidence/github", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
      setRepo(result);
      setText("");
    });
  }

  function readLinkedIn(file: File) {
    void run(async () => {
      const result = await profileRequest<{ label: string; text: string }>("/evidence/linkedin/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/pdf", "X-Resume-Filename": encodeURIComponent(file.name) },
        body: file,
      });
      setText(result.text);
      setLabel(result.label);
    });
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !mode || !text.trim() || (mode === "github" && !repo)) return;
    void run(async () => {
      const evidence: ApprovedEvidence = {
        kind: mode, label: repo?.label ?? label, url: repo?.url ?? null, text: text.trim(),
      };
      onApprove(await profileRequest<Profile>("/evidence", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: profile.version, evidence }),
      }));
      setMode(null);
      setMessage(mode === "github" ? "GitHub contribution approved." : "LinkedIn evidence approved.");
    });
  }

  function remove(kind: ApprovedEvidence["kind"]) {
    void run(async () => {
      onApprove(await profileRequest<Profile>(`/evidence/${kind}?version=${profile.version}`, { method: "DELETE" }));
      setMode(null);
      setMessage("Evidence removed from your saved profile.");
    });
  }

  return <section className="panel pane workflow-stack" aria-labelledby="profile-evidence-heading">
    <div><h2 id="profile-evidence-heading">Additional evidence</h2><p className="hint">Review and approve the parts you want to use in drafts.</p></div>
    <ul className="workflow-rows">
      {(["github", "linkedin"] as const).map(kind => {
        const item = profile.evidence.find(entry => entry.kind === kind);
        const title = kind === "github" ? "GitHub project" : "LinkedIn profile";
        return <li key={kind}>
          <div className="workflow-row">
            <div><strong>{title}</strong><p className="hint">{item ? item.label + " · Approved" : kind === "github" ? "One public repository" : "PDF export or pasted text"}</p></div>
            <div className="actions">
              {item && <button type="button" className="button quiet" disabled={busy || disabled} onClick={() => remove(kind)}>Remove {title}</button>}
              <button type="button" className="button" disabled={busy || disabled} aria-expanded={mode === kind}
                onClick={() => mode === kind ? setMode(null) : open(kind)}>{item ? "Replace" : "Import"} {title}</button>
            </div>
          </div>
          {item && <details className="draft-evidence"><summary>Approved evidence</summary><blockquote>{item.text}</blockquote></details>}
        </li>;
      })}
    </ul>
    {mode === "github" && <form className="workflow-stack" onSubmit={lookup}>
      <div><label htmlFor="github-repo">Public repository URL</label>
        <input id="github-repo" value={url} disabled={busy || disabled} required maxLength={512}
          placeholder="github.com/owner/repository" onChange={event => { setUrl(event.target.value); setRepo(null); }} /></div>
      <div className="actions"><button className="button" type="submit" disabled={busy || disabled}>Review repository</button></div>
    </form>}
    {mode === "linkedin" && <div><label htmlFor="linkedin-pdf">LinkedIn PDF export</label>
      <input id="linkedin-pdf" type="file" accept=".pdf,application/pdf" disabled={busy || disabled}
        onChange={event => { const file = event.target.files?.[0]; if (file) readLinkedIn(file); }} /></div>}
    {(repo || mode === "linkedin") && <form className="workflow-stack" onSubmit={approve}>
      {repo && <section className="evidence-preview">
        <h3>{repo.label}</h3>
        <p>{repo.description}</p>
        {!!repo.languages.length && <p className="hint">{repo.languages.join(" · ")}</p>}
        {repo.readme && <details className="draft-evidence"><summary>README excerpt</summary><blockquote>{repo.readme}</blockquote></details>}
      </section>}
      <div><label htmlFor="evidence-text">{repo ? "What did you personally contribute?" : "LinkedIn text to approve"}</label>
        <textarea id="evidence-text" required rows={4} maxLength={6000} value={text} disabled={busy || disabled}
          onChange={event => setText(event.target.value)} /></div>
      <div className="actions"><button className="button primary" type="submit" disabled={busy || disabled || !text.trim()}>Approve evidence</button></div>
    </form>}
    {error ? <p className="error" role="alert">{error}</p> : (busy || message) && <p className="hint" role="status">{busy ? "Working…" : message}</p>}
  </section>;
}
