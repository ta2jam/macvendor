"use client";

import { useEffect, useState } from "react";

export function ReleaseView() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/v1/data-release")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail ?? "Veri sürümü alınamadı");
        setData(body);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="problem-card" role="alert"><strong>Veri sürümü alınamadı</strong><p>{error}</p></div>;
  if (!data) return <p className="loading-line" role="status">Aktif veri sürümü okunuyor…</p>;
  return <pre className="json-view" tabIndex={0} aria-label="Aktif veri sürümü JSON çıktısı">{JSON.stringify(data, null, 2)}</pre>;
}
