"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "../lib/api";

type JobDetails = { role: string; company: string; description: string; skills: string[] };
type JobDraft = { details: JobDetails; source_url: string | null };
export type ConfirmedJob = JobDraft & { version: number };

const maxDescription = 60_000;

type DescriptionBlock =
  | { kind: "heading" | "paragraph"; text: string }
  | { kind: "list"; items: string[] };

function descriptionBlocks(description: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const bullet = /^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    const heading = /^(?:#{1,6}\s+(.+)|\*\*([^*]+)\*\*:?|([^:]{1,65}):)$/.exec(line);
    const clean = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1");
    if (bullet) {
      const previous = blocks[blocks.length - 1];
      const item = clean(bullet[1]);
      if (previous?.kind === "list") previous.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (heading) {
      blocks.push({ kind: "heading", text: clean(heading[1] ?? heading[2] ?? heading[3]) });
    } else {
      blocks.push({ kind: "paragraph", text: clean(line) });
    }
  }
  return blocks;
}

function JobDescription({ description }: { description: string }) {
  return (
    <div className="job-description">
      {descriptionBlocks(description).map((block, index) => {
        if (block.kind === "heading") return <h4 key={index}>{block.text}</h4>;
        if (block.kind === "list") return <ul key={index}>{block.items.map((item, n) => <li key={n}>{item}</li>)}</ul>;
        return <p key={index}>{block.text}</p>;
      })}
      {!description.trim() && <p className="hint">Add a description before starting the session.</p>}
    </div>
  );
}

export function Job({
  active, confirmed, onConfirm,
}: {
  active: boolean;
  confirmed: ConfirmedJob | null;
  onConfirm: (job: ConfirmedJob) => void;
}) {
  const [link, setLink] = useState(confirmed?.source_url ?? "");
  const [text, setText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState<JobDraft | null>(confirmed);
  const [editing, setEditing] = useState(false);
  const [skillsText, setSkillsText] = useState("");
  const [busy, setBusy] = useState<"importing" | "confirming" | null>(null);
  const [importError, setImportError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const roleInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const pasteInput = useRef<HTMLTextAreaElement>(null);
  const focusReview = useRef(false);

  useEffect(() => {
    if (active && !busy && focusReview.current) {
      reviewHeading.current?.focus();
      focusReview.current = false;
    }
  }, [active, busy]);

  async function importJob(event: FormEvent<HTMLFormElement>, method: "link" | "text") {
    event.preventDefault();
    if (busy) return;
    setImportError("");
    setConfirmError("");
    const value = (method === "link" ? link : text).trim();
    if (!value) {
      setImportError(method === "link" ? "Enter a job link." : "Paste the job description first.");
      return;
    }
    setBusy("importing");
    try {
      const result = await apiRequest<JobDraft>("/api/job/import/" + method, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "link" ? { url: value } : { text: value }),
      });
      setDraft(result);
      setEditing(false);
      setPasteOpen(false);
      focusReview.current = true;
    } catch (error) {
      setImportError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function updateDetail(field: Exclude<keyof JobDetails, "skills">, value: string) {
    setConfirmError("");
    setDraft(current => current && ({ ...current, details: { ...current.details, [field]: value } }));
  }

  function reviewEdits() {
    const unique = new Map<string, string>();
    for (const line of skillsText.split(/\r?\n/)) {
      const skill = line.trim();
      if (skill && !unique.has(skill.toLowerCase())) unique.set(skill.toLowerCase(), skill);
    }
    const skills = [...unique.values()];
    if (skills.length > 30 || skills.some(skill => skill.length > 100)) {
      setConfirmError("Use up to 30 skills, with one skill of up to 100 characters per line.");
      return;
    }
    setDraft(current => current && ({ ...current, details: { ...current.details, skills } }));
    setConfirmError("");
    setEditing(false);
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft || editing) return;
    setConfirmError("");
    const { role, company, description } = draft.details;
    if ([role, company, description].some(value => !value.trim())) {
      setConfirmError("Use Edit details to fill in the role, company, and description.");
      return;
    }
    setBusy("confirming");
    try {
      const saved = await apiRequest<ConfirmedJob>("/api/job", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, version: confirmed?.version ?? 0 }),
      });
      setDraft(saved);
      onConfirm(saved);
    } catch (error) {
      setConfirmError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div hidden={!active} className="job">
      <section className="panel pane" aria-label="Import a job">
        <form className="job-link-form" onSubmit={event => void importJob(event, "link")}>
          <div>
            <label htmlFor="job-link">Job link</label>
            <input id="job-link" type="url" autoComplete="off" required maxLength={2083}
              placeholder="https://…" value={link} disabled={!!busy}
              onChange={event => { setLink(event.target.value); setImportError(""); }} />
          </div>
          <button type="submit" className="button primary" disabled={!!busy}>Import job</button>
        </form>
        <button className="button quiet job-paste-toggle" type="button" disabled={!!busy}
          aria-expanded={pasteOpen} aria-controls="job-paste"
          onClick={() => {
            setPasteOpen(!pasteOpen);
            if (!pasteOpen) requestAnimationFrame(() => pasteInput.current?.focus());
          }}>Paste job description</button>
        <form className="job-paste-form" id="job-paste" hidden={!pasteOpen}
          onSubmit={event => void importJob(event, "text")}>
          <label htmlFor="job-paste-input">Job posting</label>
          <textarea id="job-paste-input" ref={pasteInput} rows={6} required maxLength={maxDescription}
            value={text} disabled={!!busy} onChange={event => { setText(event.target.value); setImportError(""); }} />
          <button className="button" type="submit" disabled={!!busy}>Extract details</button>
        </form>
        {busy === "importing" && <p className="hint" role="status">Reading job posting…</p>}
        {importError && <p className="error" role="alert">{importError}</p>}
      </section>

      {draft && <section className="panel job-review" aria-labelledby="job-details-heading">
        <div className="job-review-heading">
          <h2 id="job-details-heading" ref={reviewHeading} tabIndex={-1}>Job details</h2>
          {!editing && <button className="button" type="button" disabled={!!busy} onClick={() => {
            setSkillsText((draft.details.skills ?? []).join("\n"));
            setConfirmError("");
            setEditing(true);
            requestAnimationFrame(() => roleInput.current?.focus());
          }}>Edit details</button>}
        </div>
        <form className="job-review-form" onSubmit={confirm}>
          {editing ? <fieldset disabled={!!busy}>
            <div className="field-grid">
              <div>
                <label htmlFor="job-role">Role</label>
                <input id="job-role" ref={roleInput} required maxLength={200}
                  value={draft.details.role} onChange={event => updateDetail("role", event.target.value)} />
              </div>
              <div>
                <label htmlFor="job-company">Company</label>
                <input id="job-company" required maxLength={200}
                  value={draft.details.company} onChange={event => updateDetail("company", event.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="job-description">Description</label>
              <textarea id="job-description" rows={7} required maxLength={maxDescription}
                value={draft.details.description} onChange={event => updateDetail("description", event.target.value)} />
            </div>
            <div>
              <label htmlFor="job-skills">Skills</label>
              <textarea id="job-skills" rows={5} maxLength={3100} value={skillsText}
                aria-describedby="job-skills-help" onChange={event => { setSkillsText(event.target.value); setConfirmError(""); }} />
              <p className="hint" id="job-skills-help">One skill per line.</p>
            </div>
          </fieldset> : <>
            <dl className="job-identity">
              <div><dt>Role</dt><dd>{draft.details.role || "—"}</dd></div>
              <div><dt>Company</dt><dd>{draft.details.company || "—"}</dd></div>
            </dl>
            <div className="job-content">
              <section className="job-skills" aria-labelledby="job-skills-heading">
                <h3 id="job-skills-heading">Skills</h3>
                {!!draft.details.skills?.length
                  ? <ul aria-label="Skills in this posting">{draft.details.skills.map(skill => <li key={skill}>{skill}</li>)}</ul>
                  : <p className="hint">No skills listed. Add them in Edit details.</p>}
              </section>
              <section className="job-description-section" aria-labelledby="job-description-heading">
                <h3 id="job-description-heading">Description</h3>
                <JobDescription description={draft.details.description} />
              </section>
            </div>
          </>}
          {confirmError && <p className="error" role="alert">{confirmError}</p>}
          <div className="form-footer">
            {editing
              ? <button key="review" className="button primary" type="button" disabled={!!busy} onClick={event => {
                  event.preventDefault();
                  reviewEdits();
                }}>Review details</button>
              : <button key="confirm" className="button primary" type="submit" disabled={!!busy}>
                  {busy === "confirming" ? "Saving…" : "Confirm job"}
                </button>}
          </div>
        </form>
      </section>}
    </div>
  );
}
