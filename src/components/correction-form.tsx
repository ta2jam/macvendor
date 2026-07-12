"use client";

import { useState, type FormEvent } from "react";

export function CorrectionForm() {
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "busy", message: "Submitting the correction request…" });
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/v1/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { reference?: string; detail?: string };
      if (!response.ok || !result.reference) throw new Error(result.detail ?? "The request could not be accepted.");
      event.currentTarget.reset();
      setStatus({ kind: "success", message: `Request accepted. Keep this reference: ${result.reference}` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "The request could not be accepted." });
    }
  }
  return (
    <form className="correction-form" onSubmit={submit}>
      <label>Category
        <select name="category" required defaultValue="incorrect_assignment">
          <option value="incorrect_assignment">Incorrect assignment</option>
          <option value="incorrect_context">Incorrect additional context</option>
          <option value="privacy">Privacy concern</option>
          <option value="rights">Data-rights concern</option>
          <option value="withdrawal">Withdrawal request</option>
        </select>
      </label>
      <label>MAC, prefix, or record reference
        <input name="target" required maxLength={128} autoComplete="off" />
      </label>
      <label>Requested change
        <textarea name="requestedChange" required minLength={20} maxLength={2000} rows={5} />
      </label>
      <label>HTTPS evidence URL
        <input name="evidenceUrl" type="url" required maxLength={2048} placeholder="https://" />
      </label>
      <label>Contact email
        <input name="contactEmail" type="email" required maxLength={254} autoComplete="email" />
      </label>
      <p className="input-hint">The contact address is encrypted at rest and is available only to audited operators.</p>
      <button type="submit" disabled={status.kind === "busy"}>Submit correction request</button>
      <p role="status" aria-live="polite" className={status.kind === "error" ? "error-text" : ""}>{status.message}</p>
    </form>
  );
}
