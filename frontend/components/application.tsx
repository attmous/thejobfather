"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "../lib/api";
import type { Profile } from "../lib/profile";
import { FitComparison, fitLabels } from "./fit";
import type { FitItem, FitScore } from "./fit";
import type { ConfirmedJob } from "./job";

type Tone = "Professional" | "Direct" | "Warm";
type Claim = { text: string; source_ids: string[] };
type Source = { id: string; field: string; text: string; url?: string | null };
type CV = {
  summary: Claim[]; experience: Claim[]; skills: Claim[];
  work_history: { heading: Claim; bullets: Claim[] }[];
  projects: Claim[]; education: Claim[]; certifications: Claim[];
};
type AtsResult = {
  pages: number; selectable_text: boolean; reading_order: boolean; contact_present: boolean;
  sections: string[]; missing_sections: string[]; matched_keywords: string[]; missing_keywords: string[]; warnings: string[];
};
type Run = {
  id: string; version: number; profile: Profile; job: ConfirmedJob; tone: Tone;
  sources: Source[]; instruction: string;
  baseline: { items: FitItem[]; resume_sources: Record<string, string> } | null;
  documents: { cv: CV; letter: Claim[]; fit: FitItem[] };
};
type State = {
  comparison: FitScore | null;
  current: Run | null; pending: { id: string } | null; error: string | null; profile_version: number;
  versions: { id: string; version: number; tone: Tone; created_at: string }[];
};

export type DraftProgress = { profileVersion: number | null; pending: boolean; failed: boolean };

function post<T>(path: string, body: object) {
  return apiRequest<T>("/api/application/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function Evidence({ ids, sources }: { ids: string[]; sources: Source[] }) {
  if (!ids.length) return null;
  return <details className="draft-evidence">
    <summary>Profile evidence</summary>
    {sources.filter(source => ids.includes(source.id)).map(source => <blockquote key={source.id}>{source.text}
      {source.url && <div><a href={source.url} target="_blank" rel="noreferrer">{source.field}</a></div>}
    </blockquote>)}
  </details>;
}

export function Application({ job, active, autoCreate = 0, onProgress }: {
  job: ConfirmedJob; active: boolean; autoCreate?: number;
  onProgress: (jobVersion: number, progress: DraftProgress) => void;
}) {
  const [data, setData] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState<"CV" | "Cover letter" | "Job fit" | "ATS check">("CV");
  const [exportFormat, setExportFormat] = useState("pdf");
  const [exporting, setExporting] = useState(false);
  const [ats, setAts] = useState<{ id: string; result: AtsResult } | null>(null);
  const [checking, setChecking] = useState(false);
  const [tone, setTone] = useState<Tone>("Professional");
  const [instruction, setInstruction] = useState("");
  const autoSeen = useRef(0);
  const lock = useRef(false);
  const selected = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const run = data?.current;
  const busy = submitting || !!data?.pending;
  const stale = !!run && run.profile.version !== data?.profile_version;

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    const result = await apiRequest<State>("/api/application?job_version=" + job.version, { signal });
    if (signal?.aborted || sequence !== loadSequence.current) return;
    setError("");
    setData(result);
    if (result.current?.id !== selected.current) {
      selected.current = result.current?.id ?? null;
      if (result.current) setTone(result.current.tone);
    }
    return result;
  }, [job.version]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await load(controller.signal);
        if (result?.pending) timer = setTimeout(refresh, 2000);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError((failure as Error).message);
          if (active || data?.pending) timer = setTimeout(refresh, 3000);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, load, data?.pending?.id]);

  useEffect(() => {
    if (!data) return;
    onProgress(job.version, { profileVersion: run?.profile.version ?? null, pending: busy, failed: !!data.error });
  }, [busy, data, job.version, onProgress, run]);

  async function generate(revision = false) {
    if (!data || lock.current || data.pending) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await post(revision ? "revise" : "generate", {
        job_version: job.version, profile_version: data.profile_version, base_id: run?.id ?? null, tone,
        ...(revision ? { instruction: instruction.trim(), document: view === "CV" ? "cv" : "letter" } : {}),
      });
      if (revision) setInstruction("");
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!active || !data || loading || !autoCreate || autoCreate <= autoSeen.current || busy) return;
    autoSeen.current = autoCreate;
    void generate();
  });

  async function select(id: string) {
    if (!run || id === run.id || lock.current || busy) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await post<State>("select", { job_version: job.version, base_id: run.id, selected_id: id });
      ++loadSequence.current;
      setData(result);
      selected.current = result.current?.id ?? null;
      if (result.current) setTone(result.current.tone);
      setInstruction("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  async function download(kind: "cv" | "letter" | "fit" | "bundle") {
    if (!run || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const path = kind === "bundle" ? `bundle.zip?format=${exportFormat}` : `${kind}.pdf`;
      const response = await fetch(`/api/application/runs/${run.id}/${path}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(typeof result?.detail === "string" ? result.detail : "Couldn’t download this file. Try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      const labels = { cv: "CV", letter: "Cover-letter", fit: "Job-fit", bundle: "Application" };
      link.download = `${labels[kind]}-v${run.version}.${kind === "bundle" ? "zip" : "pdf"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t download this file.");
    } finally {
      setDownloading(false);
    }
  }

  async function runAts() {
    if (!run || checking) return;
    setChecking(true);
    setError("");
    try {
      const result = await apiRequest<AtsResult>(`/api/application/runs/${run.id}/ats`);
      setAts({ id: run.id, result });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setChecking(false);
    }
  }

  function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (instruction.trim()) void generate(true);
  }

  const atsResult = ats && ats.id === run?.id ? ats.result : null;
  const cv = run?.documents.cv;
  const baselineByRequirement = new Map(run?.baseline?.items.map(item => [item.requirement.toLowerCase().replace(/\s+/g, " ").trim(), item]));
  const baselineSources = Object.entries(run?.baseline?.resume_sources ?? {}).map(([id, text]) => ({ id, text, field: "Original résumé" }));

  return <div className="application" hidden={!active}>
    <div className="application-heading">
      <div className="session-job"><h2>{job.details.role}</h2><p className="hint">{job.details.company}</p></div>
      {run && <div className="actions"><div className="application-version">
        <label htmlFor="draft-version">Version</label>
        <select id="draft-version" value={run.id} disabled={busy} onChange={event => void select(event.target.value)}>
          {data.versions.map(version => <option key={version.id} value={version.id}>
            {version.version} · {version.tone}
          </option>)}
        </select>
      </div><button className="button primary" type="button" aria-expanded={exporting} onClick={() => setExporting(!exporting)}>Export bundle</button></div>}
    </div>
    {run && exporting && <form className="panel pane workflow-row" onSubmit={event => { event.preventDefault(); void download("bundle"); }}>
      <div><label htmlFor="bundle-format">Bundle format</label><select id="bundle-format" value={exportFormat} onChange={event => setExportFormat(event.target.value)}>
        <option value="pdf">PDF</option><option value="md">Markdown</option><option value="tex">LaTeX</option><option value="typ">Typst</option>
      </select><p className="hint">Includes the CV, cover letter, and job-fit report.</p></div>
      <button className="button primary" type="submit" disabled={downloading}>Download ZIP</button>
    </form>}
    {loading ? <p className="hint" role="status">Loading application…</p> : !data ?
      <div className="panel standalone"><p role="alert">{error || "Couldn’t load the application."}</p>
        <button className="button" type="button" onClick={() => { setLoading(true); void load().catch(failure => setError(failure.message)).finally(() => setLoading(false)); }}>Try again</button>
      </div> : <>
      {!run && <section className="panel standalone">
        <h2>Create your application</h2>
        <p className="hint">Use your saved profile to draft a CV, cover letter, and job fit.</p>
        <div className="application-create">
          <div><label htmlFor="initial-tone">Letter tone</label>
            <select id="initial-tone" value={tone} disabled={busy} onChange={event => setTone(event.target.value as Tone)}>
              {["Professional", "Direct", "Warm"].map(value => <option key={value}>{value}</option>)}
            </select></div>
          <button className="button primary" type="button" disabled={busy} onClick={() => void generate()}>Create drafts</button>
        </div>
      </section>}
      {busy && <p className="hint" role="status">Drafting and checking against your profile…</p>}
      {(error || data.error) && <div className="application-error" role="alert">
        <p className="error">{error || data.error}</p>
        <button className="button quiet" type="button" disabled={busy} onClick={() => { setError(""); void load().catch(failure => setError(failure.message)); }}>Refresh</button>
      </div>}
      {run && <>
        {stale && <div className="draft-update"><p className="hint">Your profile has new changes.</p>
          <button className="button" type="button" disabled={busy} onClick={() => void generate()}>Update drafts</button></div>}
        <section className="panel">
          <div className="draft-tabs" role="group" aria-label="Application documents">
            {(["CV", "Cover letter", "Job fit", "ATS check"] as const).map(tab => <button className="button" type="button" key={tab}
              aria-pressed={tab === view} onClick={() => { setView(tab); setInstruction(""); }}>{tab}</button>)}
          </div>
          <article className="draft-document" aria-label={view}>
            {view === "CV" && cv ? <>
              <h2 className="draft-name">{run.profile.details.name}</h2>
              {run.profile.details.role && <p className="draft-role">{run.profile.details.role}</p>}
              {run.profile.details.contact && <p className="draft-contact">{run.profile.details.contact}</p>}
              <h3>Summary</h3>
              {cv.summary.map((block, index) => <p key={index}>{block.text}</p>)}
              {(!!cv.experience.length || !!cv.work_history.length) && <><h3>Experience</h3>
                {cv.work_history.map((entry, index) => <section className="draft-employment" key={index}>
                  <h4>{entry.heading.text}</h4><ul>{entry.bullets.map((block, i) => <li key={i}>{block.text}</li>)}</ul>
                </section>)}
                {!!cv.experience.length && <ul>{cv.experience.map((block, index) => <li key={index}>{block.text}</li>)}</ul>}</>}
              {!!cv.projects.length && <><h3>Projects</h3><ul>{cv.projects.map((block, i) => <li key={i}>{block.text}</li>)}</ul></>}
              {!!cv.skills.length && <><h3>Skills</h3><p>{cv.skills.map(block => block.text).join(", ")}</p></>}
              {!!cv.education.length && <><h3>Education</h3><ul>{cv.education.map((block, i) => <li key={i}>{block.text}</li>)}</ul></>}
              {!!cv.certifications.length && <><h3>Certifications</h3><ul>{cv.certifications.map((block, i) => <li key={i}>{block.text}</li>)}</ul></>}
            </> : view === "Cover letter" ? <>
              <h2 className="draft-name">{run.profile.details.name}</h2>
              <p className="draft-role">{run.job.details.role} · {run.job.details.company}</p>
              <p>Dear Hiring Team,</p>
              {run.documents.letter.map((block, index) => <p key={index}>{block.text}</p>)}
              <p>Kind regards,<br />{run.profile.details.name}</p>
            </> : view === "Job fit" ? <div className="workflow-stack">
              {data.comparison && <FitComparison score={data.comparison} />}
              <div className="fit-list">{run.documents.fit.map(fit => {
                const before = baselineByRequirement.get(fit.requirement.toLowerCase().replace(/\s+/g, " ").trim());
                return <section className="fit-item" key={fit.requirement}>
                  <div className="fit-heading"><h3>{fit.requirement}</h3>
                    <span className="fit-status" data-status={fit.status}>{fitLabels[fit.status]}</span></div>
                  {before && <details className="draft-evidence">
                    <summary>Before · {fitLabels[before.status]}</summary>
                    <p>{before.explanation}</p>
                    {baselineSources.filter(source => before.source_ids.includes(source.id)).map(source => <blockquote key={source.id}>{source.text}</blockquote>)}
                  </details>}
                  <p>{fit.explanation}</p>
                  <Evidence ids={fit.source_ids} sources={run.sources} />
                </section>;
              })}</div>
            </div> : <div className="workflow-stack">
              <div className="workflow-row"><div><h2>PDF readiness</h2><p className="hint">Check text extraction, reading order, contact details, and job keywords.</p></div>
                <button className="button" type="button" disabled={checking} onClick={() => void runAts()}>{checking ? "Checking…" : "Run ATS check"}</button></div>
              {atsResult && <ul className="workflow-rows" aria-live="polite">
                <li><strong>Selectable text and reading order</strong><p>{atsResult.selectable_text && atsResult.reading_order ? `Passed · ${atsResult.pages} page(s)` : "Check the exported PDF’s text and reading order."}</p></li>
                <li><strong>Contact and sections</strong><p>{atsResult.contact_present ? "Email or phone found." : "Add an email or phone to the source résumé."}</p>
                  <p className="hint">{atsResult.sections.join(" · ")}</p>
                  {!!atsResult.missing_sections.length && <p className="hint">Missing sections · {atsResult.missing_sections.join(", ")}</p>}</li>
                <li><strong>Job keyword coverage</strong><p>{atsResult.matched_keywords.length ? "Found " + atsResult.matched_keywords.join(", ") : "No listed keywords found."}</p>
                  {!!atsResult.missing_keywords.length && <p className="hint">Missing from the PDF · {atsResult.missing_keywords.join(", ")}</p>}</li>
                {!!atsResult.warnings.length && <li><strong>Bullet suggestions</strong>{atsResult.warnings.map(warning => <p key={warning}>{warning}</p>)}</li>}
              </ul>}
            </div>}
          </article>
          {view !== "ATS check" && <footer className="draft-download">
            <button className="button" type="button" disabled={downloading} onClick={() => void download(view === "CV" ? "cv" : view === "Cover letter" ? "letter" : "fit")}>
              {downloading ? "Downloading…" : `Download ${view === "CV" ? "CV" : view === "Cover letter" ? "cover letter" : "job-fit report"} PDF`}
            </button>
          </footer>}
        </section>
        {(view === "Cover letter" || view === "CV") && <form className="panel letter-revision" key={view} onSubmit={revise}>
          <h2>{view === "CV" ? "Revise CV" : "Revise letter"}</h2>
          <div className="revision-fields"><div><label htmlFor="revision-request">What would you change?</label>
            <textarea id="revision-request" rows={2} maxLength={1500} value={instruction} disabled={busy || stale} required
              placeholder={view === "CV" ? "Tighten the bullets about my project work." : "Make it shorter and focus on my product work."}
              onChange={event => setInstruction(event.target.value)} /></div>
            {view === "Cover letter" && <div><label htmlFor="revision-tone">Tone</label><select id="revision-tone" disabled={busy || stale} value={tone}
              onChange={event => setTone(event.target.value as Tone)}>
              {["Professional", "Direct", "Warm"].map(value => <option key={value}>{value}</option>)}
            </select></div>}</div>
          <div className="form-footer"><p className="hint">Each revision saves a new version.</p>
            <button className="button primary" type="submit" disabled={busy || stale || !instruction.trim()}>{view === "CV" ? "Revise CV" : "Revise letter"}</button></div>
        </form>}
        <div className="draft-bottom"><button className="button quiet" type="button" disabled={busy} onClick={() => void generate()}>Create new drafts</button></div>
      </>}
    </>}
  </div>;
}
