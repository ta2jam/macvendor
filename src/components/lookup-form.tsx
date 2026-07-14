"use client";

import { FormEvent, useState } from "react";

interface ApiResult {
  query: {
    input: string;
    normalized: string;
    flags: { locallyAdministered: boolean; multicast: boolean };
  };
  matchStatus: "matched" | "no_match";
  assignment: null | {
    prefix: string;
    prefixLength: number;
    registry: string;
    organizationName: string | null;
    address: string | null;
    source: { slug: string; sourceReleaseId: string };
  };
  curatedMatches: Array<{
    claimId: string;
    prefix: string;
    prefixLength: number;
    organizationName: string;
    verificationStatus: string;
    conflictStatus: string;
    source: { slug: string; sourceReleaseId: string };
  }>;
  insights: Array<{
    claimId: string;
    prefix: string;
    prefixLength: number;
    claimType: "vendor_alias" | "device_hint" | "usage_note";
    organizationName: string | null;
    details: Record<string, unknown>;
    verificationStatus: string;
    source: { slug: string; sourceReleaseId: string };
  }>;
  data: { activeVersion: number; policyVersion: string; generatedAt: string };
}

interface Problem {
  code?: string;
  title: string;
  detail: string;
  requestId?: string;
}

const verificationLabels: Record<string, string> = {
  reviewed: "Evidence reviewed",
  corroborated: "Corroborated by multiple records",
  single_observation: "Single observation",
  unverified: "Unverified",
};

export function LookupForm() {
  const [mac, setMac] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setProblem(null);
    setResult(null);

    try {
      const response = await fetch(`/v1/lookup/${encodeURIComponent(mac)}`, {
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as ApiResult | Problem;
      if (!response.ok) {
        setProblem(body as Problem);
      } else {
        setResult(body as ApiResult);
      }
    } catch {
      setProblem({ title: "Connection failed", detail: "The local API is not responding." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lookup-card">
      <form onSubmit={submit} aria-describedby="mac-hint">
        <label htmlFor="mac">MAC address</label>
        <div className="input-row">
          <input
            id="mac"
            name="mac"
            value={mac}
            onChange={(event) => {
              setMac(event.target.value);
              if (problem) setProblem(null);
            }}
            placeholder="e.g. 02:AA:BB:CC:00:01"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            required
            aria-describedby="mac-hint"
            aria-invalid={problem?.code === "INVALID_MAC" ? true : undefined}
          />
          <button type="submit" disabled={loading}>{loading ? "Looking up…" : "Look up"}</button>
        </div>
        <p className="input-hint" id="mac-hint">
          Enter 12 hexadecimal characters or a colon-, hyphen-, or dot-separated MAC address.
        </p>
      </form>

      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "Looking up the MAC address." : result?.matchStatus === "no_match" ? "Lookup complete. No official assignment matched." : result ? "Lookup result ready." : ""}
      </p>
      <div className="result-region" role="region" aria-label="MAC lookup status" aria-busy={loading}>
        {loading && <p className="loading-line lookup-loading" aria-hidden="true">Looking up…</p>}
        {problem && (
          <div className="problem-card" role="alert">
            <strong>{problem.title}</strong>
            <p>{problem.detail}</p>
            {problem.requestId && <small>{problem.requestId}</small>}
          </div>
        )}

        {result && (
          <div className="results">
            <div className="result-meta">
              <span>{result.query.normalized}</span>
              <span>release #{result.data.activeVersion}</span>
              {result.query.flags.locallyAdministered && <span className="flag">Locally administered</span>}
              {result.query.flags.multicast && <span className="flag">Multicast</span>}
            </div>

            <article className="result-block official">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">Authoritative assignment</p>
                  <h2>{result.matchStatus === "no_match" ? "No official match found" : result.assignment?.organizationName}</h2>
                </div>
                {result.assignment && <span className="registry-badge">{result.assignment.registry}</span>}
              </div>
              {result.assignment && (
                <dl>
                  <div><dt>Prefix</dt><dd>{result.assignment.prefix}/{result.assignment.prefixLength}</dd></div>
                  <div><dt>Source</dt><dd>{result.assignment.source.slug}</dd></div>
                  <div><dt>Address</dt><dd>{result.assignment.address ?? "Not published"}</dd></div>
                </dl>
              )}
              {result.matchStatus === "no_match" && (
                <p className="empty-state">No active 36-, 28-, or 24-bit official assignment matches this address.</p>
              )}
              <p className="notice">This record does not conclusively identify the device&apos;s actual manufacturer.</p>
            </article>

            <section className="curated-section">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">Separate data layer</p>
                  <h2>Curated matches</h2>
                </div>
                <span>{result.curatedMatches.length}</span>
              </div>
              {result.curatedMatches.length === 0 ? (
                <p className="empty-state">No public curated claim exists for this MAC address.</p>
              ) : result.curatedMatches.map((claim) => (
                <article className="claim" key={claim.claimId}>
                  <div>
                    <strong>{claim.organizationName}</strong>
                    <p>{claim.prefix}/{claim.prefixLength} · {claim.source.slug}</p>
                  </div>
                  <span>{verificationLabels[claim.verificationStatus] ?? claim.verificationStatus}</span>
                </article>
              ))}
            </section>

            {result.insights.length > 0 && (
              <section className="curated-section">
                <div className="result-heading">
                  <div>
                    <p className="eyebrow">Protocol and enrichment layer</p>
                    <h2>Additional context</h2>
                  </div>
                  <span>{result.insights.length}</span>
                </div>
                {result.insights.map((insight) => (
                  <article className="claim" key={insight.claimId}>
                    <div>
                      <strong>{insight.organizationName
                        ?? String(insight.details.usage ?? insight.details.platform ?? insight.claimType)}</strong>
                      <p>{insight.prefix}/{insight.prefixLength} · {insight.source.slug}</p>
                    </div>
                    <span>{insight.claimType.replaceAll("_", " ")}</span>
                  </article>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
