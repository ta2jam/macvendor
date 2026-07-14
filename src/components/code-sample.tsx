"use client";

import { useState } from "react";

export function CodeSample({ label, code }: { label: string; code: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2_000);
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="code-sample">
      <div className="code-sample-heading">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${label} example`}>
          {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${label} code example`}><code>{code}</code></pre>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? `${label} example copied to clipboard.` : status === "failed" ? "Copy failed." : ""}
      </span>
    </div>
  );
}
