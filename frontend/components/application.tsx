"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { apiRequest } from "../lib/api";
import type { Profile } from "../lib/profile";
import type { ConfirmedJob } from "./job";

type Tone = "Professional" | "Direct" | "Warm";
type Claim = { text: string; source_ids: string[] };
type Source = { id: string; field: string; text: string };
type Fit = { requirement: string; status: "supported" | "partial" | "unknown"; explanation: string; source_ids: string[] };
type Run = {
  id: string; version: number; profile: Profile; job: ConfirmedJob; tone: Tone;
  sources: Source[]; instruction: string;
  documents: { cv: { summary: Claim[]; experience: Claim[]; skills: Claim[] }; letter: Claim[]; fit: Fit[] };
};
type State = {
  current: Run | null; pending: { id: string } | null; error: string | null; profile_version: number;
  versions: { id: string; version: number; tone: Tone; created_at: string }[];
};

function post<T>(path: string, body: object) {
  return apiRequest<T>("/api/application/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function Evidence({ ids, sources }: { ids: string[]; sources: Source[] }) {
  if (!ids.length) return null;
  return <details className="draft-evidence">
    <summary>Profile evidence</summary>
    {sources.filter(source => ids.includes(source.id)).map(source => <blockquote key={source.id}>{source.text}</blockquote>)}
  </details>;
}

export function Application({ job, active, autoCreate = 0 }: {
  job: ConfirmedJob; active: boolean; autoCreate?: number;
}) {
  const [data, setData] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState<"CV" | "Cover letter" | "Job fit">("CV");
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
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await load(controller.signal);
        if (result?.pending) timer = setTimeout(refresh, 2000);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError((failure as Error).message);
          timer = setTimeout(refresh, 3000);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, load, data?.pending?.id]);

  async function generate(revision = false) {
    if (!data || lock.current || data.pending) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await post(revision ? "revise" : "generate", {
        job_version: job.version, profile_version: data.profile_version, base_id: run?.id ?? null, tone,
        ...(revision ? { instruction: instruction.trim() } : {}),
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

  async function download(kind: "cv" | "letter") {
    if (!run || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`/api/application/runs/${run.id}/${kind}.pdf`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(typeof result?.detail === "string" ? result.detail : "Couldn’t download this PDF. Try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${kind === "cv" ? "CV" : "Cover-letter"}-v${run.version}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn’t download this PDF.");
    } finally {
      setDownloading(false);
    }
  }

  function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (instruction.trim()) void generate(true);
  }

  return <div className="application" hidden={!active}>
    <div className="application-heading">
      <div className="session-job"><h2>{job.details.role}</h2><p className="hint">{job.details.company}</p></div>
      {run && <div className="application-version">
        <label htmlFor="draft-version">Version</label>
        <select id="draft-version" value={run.id} disabled={busy} onChange={event => void select(event.target.value)}>
          {data.versions.map(version => <option key={version.id} value={version.id}>
            {version.version} · {version.tone}
          </option>)}
        </select>
      </div>}
    </div>
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
            {(["CV", "Cover letter", "Job fit"] as const).map(tab => <button className="button" type="button" key={tab}
              aria-pressed={tab === view} onClick={() => setView(tab)}>{tab}</button>)}
          </div>
          <article className="draft-document" aria-label={view}>
            {view === "CV" ? <>
              <h2 className="draft-name">{run.profile.details.name}</h2>
              {run.profile.details.role && <p className="draft-role">{run.profile.details.role}</p>}
              <h3>Profile</h3>
              {run.documents.cv.summary.map((block, index) => <p key={index}>{block.text}</p>)}
              {!!run.documents.cv.experience.length && <><h3>Experience</h3>
                <ul>{run.documents.cv.experience.map((block, index) => <li key={index}>{block.text}</li>)}</ul></>}
              {!!run.documents.cv.skills.length && <><h3>Skills</h3><p>{run.documents.cv.skills.map(block => block.text).join(", ")}</p></>}
            </> : view === "Cover letter" ? <>
              <h2 className="draft-name">{run.profile.details.name}</h2>
              <p className="draft-role">{run.job.details.role} · {run.job.details.company}</p>
              <p>Dear Hiring Team,</p>
              {run.documents.letter.map((block, index) => <p key={index}>{block.text}</p>)}
              <p>Kind regards,<br />{run.profile.details.name}</p>
            </> : <div className="fit-list">{run.documents.fit.map((fit, index) => <section className="fit-item" key={index}>
              <div className="fit-heading"><h3>{fit.requirement}</h3>
                <span className="fit-status" data-status={fit.status}>{{ supported: "Supported", partial: "Partial", unknown: "Not established" }[fit.status]}</span></div>
              <p>{fit.explanation}</p>
              <Evidence ids={fit.source_ids} sources={run.sources} />
            </section>)}</div>}
          </article>
          {view !== "Job fit" && <footer className="draft-download">
            <button className="button" type="button" disabled={downloading} onClick={() => void download(view === "CV" ? "cv" : "letter")}>
              {downloading ? "Preparing PDF…" : `Download ${view === "CV" ? "CV" : "cover letter"} PDF`}
            </button>
          </footer>}
        </section>
        {view === "Cover letter" && <form className="panel letter-revision" onSubmit={revise}>
          <h2>Revise letter</h2>
          <div className="revision-fields"><div><label htmlFor="revision-request">What would you change?</label>
            <textarea id="revision-request" rows={2} maxLength={1500} value={instruction} disabled={busy || stale} required
              placeholder="Make it shorter and focus on my product work."
              onChange={event => setInstruction(event.target.value)} /></div>
            <div><label htmlFor="revision-tone">Tone</label><select id="revision-tone" disabled={busy || stale} value={tone}
              onChange={event => setTone(event.target.value as Tone)}>
              {["Professional", "Direct", "Warm"].map(value => <option key={value}>{value}</option>)}
            </select></div></div>
          <div className="form-footer"><p className="hint">Each revision saves a new version.</p>
            <button className="button primary" type="submit" disabled={busy || stale || !instruction.trim()}>Revise letter</button></div>
        </form>}
        <div className="draft-bottom"><button className="button quiet" type="button" disabled={busy} onClick={() => void generate()}>Create new drafts</button></div>
      </>}
    </>}
  </div>;
}
