import type { Metadata } from "next";

export const metadata: Metadata = { title: "API problem type" };

const descriptions: Record<string, string> = {
  "invalid-mac": "The MAC value must use one of the four supported 48-bit formats.",
  "invalid-prefix": "The prefix and length must match the registry contract.",
  "invalid-registry": "The registry must be ma-l, ma-m, ma-s, iab, or cid.",
  "unsupported-parameter": "The endpoint accepts only query parameters defined by its contract.",
  "assignment-not-found": "No exact registry/prefix record exists in the active release.",
  "rate-limited": "The request rate exceeded the protection threshold; follow the Retry-After header.",
  "data-release-unavailable": "The service could not find a validated active release.",
  "service-unavailable": "A temporary infrastructure error occurred; retry with the request ID.",
};

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <section className="shell content-page">
      <p className="eyebrow">RFC 9457 problem type</p>
      <h1>{slug}</h1>
      <p className="lead">{descriptions[slug] ?? "No public description is available for this problem type."}</p>
    </section>
  );
}
