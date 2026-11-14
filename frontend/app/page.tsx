"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import logo from "../../assets/thejobfather-logo.png";
import { Job } from "../components/job";
import type { ConfirmedJob } from "../components/job";
import { Session } from "../components/session";
import type { FactApproval } from "../components/session";
import { Settings } from "../components/settings";
import { Application } from "../components/application";
import { ProfileIcon } from "../components/profile-icon";
import { apiRequest } from "../lib/api";
import { PROFILE_URL_LIMIT, profileRequest } from "../lib/profile";
import type { Profile } from "../lib/profile";

const steps = ["Profile", "Job", "Session", "Application"] as const;
type Step = (typeof steps)[number];

export default function Home() {
  const [step, setStep] = useState<Step>("Profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [github, setGithub] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [confirmedJob, setConfirmedJob] = useState<ConfirmedJob | null>(null);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobError, setJobError] = useState("");
  const [autoCreate, setAutoCreate] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const currentStep = useRef<Step>("Profile");
  const title = useRef<HTMLHeadingElement>(null);

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      const saved = await profileRequest<Profile>();
      setProfile(saved);
      setGithub(saved.github_url ?? "");
      setLinkedin(saved.linkedin_url ?? "");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); }, []);

  async function loadJob() {
    setJobLoading(true);
    setJobError("");
    try {
      setConfirmedJob(await apiRequest<ConfirmedJob | null>("/api/job"));
    } catch (failure) {
      setJobError((failure as Error).message);
    } finally {
      setJobLoading(false);
    }
  }

  useEffect(() => { void loadJob(); }, []);

  function goTo(next: Step) {
    if (next === currentStep.current) return;
    currentStep.current = next;
    setStep(next);
    requestAnimationFrame(() => title.current?.focus());
  }

  function selectResume(file: File) {
    setNotice("");
    setError("");
    if (!file.name.toLowerCase().endsWith(".pdf") || file.size > 10 * 1024 * 1024) {
      setError("Choose a PDF up to 10 MB.");
      return;
    }
    setResumeFile(file);
    setPasteOpen(false);
    setResumeText("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || saving) return;
    setError("");
    setNotice("");
    setSaving(true);
    const links = { version: profile.version, github_url: github, linkedin_url: linkedin };
    try {
      const saved = resumeFile ? await profileRequest<Profile>("/sources/pdf", {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "X-Resume-Filename": encodeURIComponent(resumeFile.name),
          "X-Profile-Sources": encodeURIComponent(JSON.stringify(links)),
        },
        body: resumeFile,
      }) : await profileRequest<Profile>("/sources", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...links, resume_text: resumeText }),
      });
      setProfile(saved);
      setGithub(saved.github_url ?? "");
      setLinkedin(saved.linkedin_url ?? "");
      setResumeFile(null);
      setResumeText("");
      setPasteOpen(false);
      setNotice("Profile saved.");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function applyFactApproval({ profile: saved, previous_profile_version }: FactApproval) {
    if (profile?.version !== previous_profile_version) {
      setNotice("Profile changed in another tab. Reload to see the latest inputs.");
      return;
    }
    setProfile(current => current?.version === previous_profile_version ? saved : current);
  }

  const savedName = profile?.details.name ?? "";
  const initials = savedName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join("").toUpperCase();
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="header">
        <Image className="logo" src={logo} alt="TheJobFather" width={132} height={56} preload />
        <div className="header-actions">
          <Settings />
          {initials && <span className="initials" aria-label={savedName}>{initials}</span>}
        </div>
      </header>
      <div className="shell">
        <nav className="steps" aria-label="Application steps">
          {steps.map((item, index) => (
            <button key={item} type="button" className="step"
              aria-current={step === item ? "step" : undefined}
              disabled={saving} onClick={() => goTo(item)}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{item}
            </button>
          ))}
        </nav>
        <main className="main" id="main">
          <h1 ref={title} tabIndex={-1}>{step}</h1>
          {!jobLoading && !jobError && (
            <Job active={step === "Job"} confirmed={confirmedJob} onConfirm={job => {
              if (job.version !== confirmedJob?.version) setAutoCreate(0);
              setConfirmedJob(job);
              if (currentStep.current === "Job") goTo("Session");
            }} />
          )}
          {step === "Job" && jobLoading && <p role="status">Loading job…</p>}
          {step === "Job" && jobError && <div className="panel standalone">
            <p role="alert">{jobError}</p>
            <button className="button" type="button" onClick={() => void loadJob()}>Try again</button>
          </div>}
          {confirmedJob && !!profile?.version && <Session
            key={`session-${confirmedJob.version}`} job={confirmedJob} active={step === "Session"} onApprove={applyFactApproval}
            onCreateDrafts={() => { setAutoCreate(value => value + 1); goTo("Application"); }} />}
          {confirmedJob && !!profile?.version && <Application key={`application-${confirmedJob.version}`} job={confirmedJob}
            active={step === "Application"} autoCreate={autoCreate} />}
          {step === "Profile" ? (
            loading ? <p role="status">Loading profile…</p> :
            !profile ? (
              <div className="panel standalone">
                <p role="alert">{error}</p><button className="button" onClick={() => void loadProfile()}>Try again</button>
              </div>
            ) : (
              <form className="panel profile-form" onSubmit={save}>
                <div className="profile-grid">
                  <section className="pane" aria-labelledby="resume-heading">
                    <h2 id="resume-heading" className="profile-icon-label"><ProfileIcon name="resume" />Resume</h2>
                    <div className="profile-inputs">
                      {(resumeFile || profile.resume) && <div className="resume-source">
                        <p className="source">{resumeFile?.name ?? profile.resume?.label}</p>
                        {resumeFile ? (
                          <button className="text-button" type="button" disabled={saving} onClick={() => setResumeFile(null)}>Cancel change</button>
                        ) : profile.resume?.stored && (
                          <a href="/api/profile/resume" download>Download</a>
                        )}
                      </div>}
                      <input type="file" ref={fileInput} hidden accept=".pdf,application/pdf"
                        onChange={event => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) selectResume(file);
                        }} />
                      <div className="resume-actions">
                        <button className="button" type="button" disabled={saving} onClick={() => fileInput.current?.click()}>
                          {resumeFile || profile.resume?.kind === "pdf" ? "Replace PDF" : "Choose PDF"}
                        </button>
                        <button className="button quiet" type="button" disabled={saving}
                          aria-expanded={pasteOpen} aria-controls="paste-resume"
                          onClick={() => { setPasteOpen(!pasteOpen); setResumeFile(null); setResumeText(""); setNotice(""); setError(""); }}>
                          {pasteOpen ? "Cancel paste" : "Paste text"}
                        </button>
                      </div>
                      <div id="paste-resume" hidden={!pasteOpen}>
                        <label htmlFor="resume-text">Resume text</label>
                        <textarea id="resume-text" value={resumeText} maxLength={60_000} disabled={saving} rows={5}
                          onChange={event => setResumeText(event.target.value)} />
                      </div>
                      <p className="hint">PDF up to 10 MB. Gemini reads your resume when you save it.</p>
                    </div>
                  </section>
                  <section className="pane" aria-labelledby="links-heading">
                    <h2 id="links-heading">Profile links <span className="hint">(optional)</span></h2>
                    <fieldset className="profile-inputs" disabled={saving}>
                      <div>
                        <label htmlFor="github" className="profile-icon-label"><ProfileIcon name="github" />GitHub</label>
                        <input id="github" type="text" inputMode="url" autoCapitalize="none" spellCheck={false}
                          placeholder="github.com/username" maxLength={PROFILE_URL_LIMIT} value={github}
                          onChange={event => { setGithub(event.target.value); setNotice(""); setError(""); }} />
                      </div>
                      <div>
                        <label htmlFor="linkedin" className="profile-icon-label"><ProfileIcon name="linkedin" />LinkedIn</label>
                        <input id="linkedin" type="text" inputMode="url" autoCapitalize="none" spellCheck={false}
                          placeholder="linkedin.com/in/username" maxLength={PROFILE_URL_LIMIT} value={linkedin}
                          onChange={event => { setLinkedin(event.target.value); setNotice(""); setError(""); }} />
                      </div>
                    </fieldset>
                  </section>
                </div>
                <div className="form-footer profile-footer">
                  {error ? <p className="error" role="alert">{error}</p> :
                    <p className="hint" role="status">{saving ? "Saving profile…" : notice}</p>}
                  <button className="button primary" type="submit" disabled={saving}>Save profile</button>
                </div>
              </form>
            )
          ) : step === "Session" && (!confirmedJob || !profile?.version) ? (
            <div className="panel standalone">
              <p className="hint">{loading || jobLoading ? "Loading session…" : !profile?.version
                ? "Save your profile before starting the session." : "Confirm a job before starting the session."}</p>
              {!loading && !jobLoading && <button className="button" type="button" onClick={() => goTo(profile?.version ? "Job" : "Profile")}>
                {profile?.version ? "Back to job" : "Back to profile"}
              </button>}
            </div>
          ) : step === "Application" && (!confirmedJob || !profile?.version) && (
            <div className="panel standalone">
              <p className="hint">{loading || jobLoading ? "Loading application…" : !profile?.version
                ? "Save your profile before creating drafts." : "Confirm a job before creating drafts."}</p>
              <button className="button" type="button" onClick={() => goTo(profile?.version ? "Job" : "Profile")}>
                {profile?.version ? "Back to job" : "Back to profile"}
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
