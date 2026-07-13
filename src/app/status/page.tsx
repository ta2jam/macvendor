import type { Metadata } from "next";
import { StatusView } from "@/components/status-view";

export const metadata: Metadata = { title: "Service status" };

export default function StatusPage() {
  return <section className="shell content-page">
    <p className="eyebrow">Operations</p><h1>Service status</h1>
    <p className="lead">Current publication state and aggregate changes from the preceding governed release.</p>
    <StatusView />
  </section>;
}
