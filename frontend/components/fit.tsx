"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export type FitItem = {
  requirement: string;
  status: "supported" | "partial" | "unknown";
  explanation: string;
  source_ids: string[];
};
export type FitScore = {
  before: number;
  after: number | null;
  rows: { area: string; max: number; before: number | null; after: number | null }[];
};

export const fitLabels = { supported: "Supported", partial: "Partial", unknown: "Not established" };

export function FitComparison({ score }: { score: FitScore }) {
  return <div className="fit-comparison">
    <div className="fit-scores">
      <div><span>Before</span><strong>{score.before}<small> / 100</small></strong><span>Original résumé</span></div>
      {score.after !== null && <div><span>After</span><strong>{score.after}<small> / 100</small></strong><span>Tailored application</span></div>}
    </div>
    <details className="fit-rubric">
      <summary>Score breakdown</summary>
      <table>
        <thead><tr><th scope="col">Area</th><th scope="col">Before</th>{score.after !== null && <th scope="col">After</th>}</tr></thead>
        <tbody>{score.rows.map(row => <tr key={row.area}>
          <th scope="row">{row.area}</th>
          <td>{row.before === null ? "—" : `${row.before} / ${row.max}`}</td>
          {score.after !== null && <td>{row.after === null ? "—" : `${row.after} / ${row.max}`}</td>}
        </tr>)}</tbody>
      </table>
    </details>
    <p className="hint">Estimate based on evidence for the assessed job requirements.</p>
  </div>;
}

type Baseline = { items: FitItem[]; score: FitScore };

export function CheckFit({ jobVersion, jobTitle, profileVersion, onContinue }: {
  jobVersion: number; jobTitle: string; profileVersion: number; onContinue: () => void;
}) {
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = "/api/application/baseline?job_version=" + jobVersion;

  useEffect(() => {
    const controller = new AbortController();
    setBaseline(null);
    setError("");
    apiRequest<Baseline | null>(endpoint, { signal: controller.signal })
      .then(setBaseline)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [endpoint, profileVersion]);

  async function check() {
    setBusy(true);
    setError("");
    try {
      setBaseline(await apiRequest<Baseline>(endpoint, { method: "POST" }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel pane workflow-stack" aria-labelledby="baseline-fit-heading">
    <header><h2 id="baseline-fit-heading">Check fit</h2><p className="hint">Compare your original résumé with {jobTitle} before the interview.</p></header>
    {baseline && <>
      <FitComparison score={baseline.score} />
      <ul className="workflow-rows">{baseline.items.map(item => <li key={item.requirement}>
        <div className="fit-heading"><strong>{item.requirement}</strong><span className="fit-status" data-status={item.status}>{fitLabels[item.status]}</span></div>
        <p className="hint">{item.explanation}</p>
      </li>)}</ul>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions">
      {!baseline && <button className="button primary" type="button" disabled={busy} onClick={() => void check()}>{busy ? "Checking fit…" : "Check baseline"}</button>}
      <button className={baseline ? "button primary" : "button"} type="button" disabled={busy} onClick={onContinue}>Start session</button>
    </div>
  </section>;
}
