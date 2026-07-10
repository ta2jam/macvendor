"use client";

import { FormEvent, useState } from "react";

interface ApiResult {
  query: {
    input: string;
    normalized: string;
    flags: { locallyAdministered: boolean; multicast: boolean };
  };
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
  data: { activeVersion: number; policyVersion: string; generatedAt: string };
}

interface Problem {
  title: string;
  detail: string;
  requestId?: string;
}

const verificationLabels: Record<string, string> = {
  reviewed: "Kanıtı incelendi",
  corroborated: "Birden fazla kayıtla destekleniyor",
  single_observation: "Tek gözlem",
  unverified: "Doğrulanmamış",
};

export function LookupForm() {
  const [mac, setMac] = useState("02:AA:BB:CC:00:01");
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
      setProblem({ title: "Bağlantı kurulamadı", detail: "Lokal API yanıt vermiyor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lookup-card">
      <form onSubmit={submit}>
        <label htmlFor="mac">MAC adresi</label>
        <div className="input-row">
          <input
            id="mac"
            name="mac"
            value={mac}
            onChange={(event) => setMac(event.target.value)}
            placeholder="Örn. 02:AA:BB:CC:00:01"
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
          />
          <button type="submit" disabled={loading}>{loading ? "Sorgulanıyor…" : "Sorgula"}</button>
        </div>
        <p className="input-hint">Demo kayıt: <button type="button" onClick={() => setMac("02:AA:BB:CC:00:01")}>02:AA:BB:CC:00:01</button></p>
      </form>

      <div className="result-region" aria-live="polite">
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
              {result.query.flags.locallyAdministered && <span className="flag">Yerel yönetilen</span>}
              {result.query.flags.multicast && <span className="flag">Multicast</span>}
            </div>

            <article className="result-block official">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">Authoritative assignment</p>
                  <h2>{result.assignment?.organizationName ?? "Resmî eşleşme bulunamadı"}</h2>
                </div>
                {result.assignment && <span className="registry-badge">{result.assignment.registry}</span>}
              </div>
              {result.assignment && (
                <dl>
                  <div><dt>Prefix</dt><dd>{result.assignment.prefix}/{result.assignment.prefixLength}</dd></div>
                  <div><dt>Kaynak</dt><dd>{result.assignment.source.slug}</dd></div>
                  <div><dt>Adres</dt><dd>{result.assignment.address ?? "Yayımlanmıyor"}</dd></div>
                </dl>
              )}
              <p className="notice">Bu kayıt cihazın gerçek üreticisini kesin olarak tanımlamaz.</p>
            </article>

            <section className="curated-section">
              <div className="result-heading">
                <div>
                  <p className="eyebrow">Ayrı veri katmanı</p>
                  <h2>Kürasyonlu eşleşmeler</h2>
                </div>
                <span>{result.curatedMatches.length}</span>
              </div>
              {result.curatedMatches.length === 0 ? (
                <p className="empty-state">Bu MAC için public kürasyonlu iddia yok.</p>
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
          </div>
        )}
      </div>
    </div>
  );
}
