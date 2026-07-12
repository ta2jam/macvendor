import type { Metadata } from "next";

export const metadata: Metadata = { title: "Methodology" };

export default function MethodologyPage() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">How does it work?</p>
      <h1>Methodology</h1>
      <p className="lead">Input is validated, converted to an unchanged 48-bit value, and queried against the active data release.</p>
      <ol className="steps">
        <li><span>1</span><div><h2>Strict normalization</h2><p>Four explicit MAC formats are accepted. U/L and I/G bits are never cleared.</p></div></li>
        <li><span>2</span><div><h2>Longest-prefix match</h2><p>Authoritative candidates are checked at 36, 28, and 24 bits. CID is excluded from full-MAC lookup.</p></div></li>
        <li><span>3</span><div><h2>Separate claim layer</h2><p>Owner-curated results are searched from 1–48 bits and never overwrite an official assignment.</p></div></li>
        <li><span>4</span><div><h2>Versioning and suppression</h2><p>Every response identifies the active release. Emergency suppression changes the cache version.</p></div></li>
      </ol>
    </section>
  );
}
