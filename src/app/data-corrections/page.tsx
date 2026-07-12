import type { Metadata } from "next";
import Link from "next/link";
import { dataCorrectionsEmail } from "@/lib/public-config";

export const metadata: Metadata = {
  title: "Data correction and withdrawal",
  description: "Process for reporting an incorrect MAC assignment or curated claim.",
};

export const dynamic = "force-dynamic";

export default function DataCorrectionsPage() {
  const email = dataCorrectionsEmail();
  const subject = encodeURIComponent("[macvendor.io] Data correction request");

  return (
    <section className="shell content-page policy-page">
      <p className="eyebrow">Correction channel</p>
      <h1>Data correction and withdrawal</h1>
      <p className="lead">
        Report an incorrect registrant, curated claim, privacy issue, or data-rights concern with the
        relevant source and evidence. A request does not automatically change the public result.
      </p>

      {email ? (
        <div className="callout intake-ready" role="status">
          <strong>The correction channel is available.</strong>
          <p>
            Send the request to <code>{email}</code>. Contact details and evidence are not made public
            or written to the macvendor PostgreSQL database.
          </p>
          <a className="action-link" href={`mailto:${email}?subject=${subject}`}>
            Create correction email
          </a>
        </div>
      ) : (
        <div className="callout warning" role="status">
          <strong>The correction intake channel is not configured for this deployment.</strong>
          <p>
            Even if the application appears healthy, this fails the production launch gate. No fake
            form is shown that pretends to accept a request.
          </p>
        </div>
      )}

      <ol className="steps correction-steps">
        <li>
          <span>1</span>
          <div>
            <h2>Identify the record</h2>
            <p>Provide the relevant MAC or prefix, source name, and the exact claim shown on screen.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h2>Explain the request and its basis</h2>
            <p>
              Include the requested correction, a verifiable reference or evidence link, and contact
              details needed for a response. Do not send passwords, private keys, or unnecessary
              personal data.
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h2>Review and temporary action</h2>
            <p>
              The target for initial human review is 2 business days; the normal decision target is
              10 business days. Clear personal-data, security, or severe misattribution reports enter
              a 24-hour temporary suppression review queue.
            </p>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <h2>Auditable decision</h2>
            <p>
              A request may be rejected with reasons, corrected through a new source release, handled
              with temporary or permanent suppression, or escalated for rights/privacy review.
            </p>
          </div>
        </li>
      </ol>

      <div className="policy-grid compact">
        <article>
          <h2>Immutable record policy</h2>
          <p>
            Source and resolution release rows are never retroactively mutated. Emergency visibility
            changes use ticket-referenced suppression; permanent data changes use a new release. Every
            decision produces an audit trail.
          </p>
        </article>
        <article>
          <h2>Security reports use a separate channel</h2>
          <p>
            Do not send application vulnerabilities or credential leaks to the correction address. Use the
            <a href="https://github.com/ta2jam/macvendor/security/advisories/new"> private security
            advisory</a> channel instead.
          </p>
        </article>
      </div>

      <p className="policy-date">
        Process details should be read together with the <Link href="/legal/data-terms">data terms</Link> and the active
        <Link href="/data-release"> data release</Link>.
      </p>
    </section>
  );
}
