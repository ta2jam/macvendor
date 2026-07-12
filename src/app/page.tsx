import { LookupForm } from "@/components/lookup-form";
import { APP_VERSION } from "@/lib/version";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <p className="eyebrow">Known source. Explainable result.</p>
            <h1>Find the registrant of a MAC address block.</h1>
            <p className="hero-copy">
              Query official assignments and separate owner-curated claims using longest-prefix matching.
            </p>
          </div>
          <div className="stat-card" aria-label={`v${APP_VERSION} feature summary`}>
            <span>v{APP_VERSION}</span>
            <strong>36 → 28 → 24 bit</strong>
            <p>Fixed candidate set, versioned results, and explicit provenance.</p>
          </div>
        </div>
      </section>
      <section className="shell lookup-section">
        <LookupForm />
      </section>
      <section className="shell principles" aria-labelledby="principles-title">
        <div>
          <p className="eyebrow">Boundaries</p>
          <h2 id="principles-title">We keep every claim precise.</h2>
        </div>
        <div className="principle-grid">
          <article>
            <span aria-hidden="true">01</span>
            <h3>An assignment is not a device identity</h3>
            <p>The result identifies a registry holder. A MAC address can be changed or randomized.</p>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>Sources remain separate</h3>
            <p>An owner-curated claim can never silently overwrite an authoritative assignment.</p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>Every result is versioned</h3>
            <p>The active release and policy version are included in every API response.</p>
          </article>
        </div>
      </section>
    </>
  );
}
