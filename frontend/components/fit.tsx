"use client";

import { useEffect, useRef, useState } from "react";
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

export function SessionFit({ jobVersion, profileVersion }: {
  jobVersion: number; profileVersion: number;
}) {
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const endpoint = "/api/application/baseline?job_version=" + jobVersion;
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setBaseline(null);
    setBusy(false);
    setLoading(true);
    setError("");
    apiRequest<Baseline | null>(endpoint, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setBaseline(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, profileVersion]);

  async function check() {
    if (!request.current || request.current.signal.aborted || loading || busy) return;
    const controller = request.current;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<Baseline>(endpoint, { method: "POST", signal: controller.signal });
      if (!controller.signal.aborted) setBaseline(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="panel pane workflow-stack session-fit" aria-labelledby="baseline-fit-heading">
    <div className="workflow-row">
      <div><h2 id="baseline-fit-heading">Job fit</h2><p className="hint">Baseline estimate from your original résumé</p></div>
      {baseline ? <p className="session-fit-value"><strong>{baseline.score.before}</strong> / 100</p>
        : <button className="button" type="button" disabled={busy || loading} onClick={() => void check()}>
          {busy ? "Checking fit…" : "Check baseline"}
        </button>}
    </div>
    {baseline && <details className="session-fit-details">
      <summary>View fit details</summary>
      <FitComparison score={baseline.score} />
      <ul className="workflow-rows">{baseline.items.map(item => <li key={item.requirement}>
        <div className="fit-heading"><strong>{item.requirement}</strong><span className="fit-status" data-status={item.status}>{fitLabels[item.status]}</span></div>
        <p className="hint">{item.explanation}</p>
      </li>)}</ul>
    </details>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
