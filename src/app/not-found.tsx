import Link from "next/link";

export default function NotFound() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">404</p>
      <h1>Page not found.</h1>
      <p className="lead">The requested page does not exist.</p>
      <Link className="text-link" href="/">Return home</Link>
    </section>
  );
}
