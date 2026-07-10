import Link from "next/link";

export default function NotFound() {
  return (
    <section className="shell content-page">
      <p className="eyebrow">404</p>
      <h1>Sayfa bulunamadı.</h1>
      <p className="lead">İstenen web sayfası mevcut değil.</p>
      <Link className="text-link" href="/">Ana sayfaya dön</Link>
    </section>
  );
}
