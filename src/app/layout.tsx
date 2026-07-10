import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "macvendor.io — MAC assignment lookup",
    template: "%s — macvendor.io",
  },
  description: "Source-aware MAC address block assignment lookup with explicit provenance.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        <header className="site-header">
          <div className="shell header-inner">
            <Link className="brand" href="/" aria-label="macvendor.io ana sayfa">
              <span className="brand-mark" aria-hidden="true">M</span>
              <span>macvendor<span>.io</span></span>
            </Link>
            <nav aria-label="Ana navigasyon">
              <Link href="/methodology">Metodoloji</Link>
              <Link href="/data-sources">Kaynaklar</Link>
              <Link href="/data-release">Veri sürümü</Link>
              <Link href="/api-docs">API</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          <div className="shell footer-grid">
            <p>
              Sonuçlar adres bloğu kayıtlarını ve ayrı kullanıcı iddialarını gösterir; cihazın gerçek
              üreticisini, modelini veya sahibini kanıtlamaz.
            </p>
            <span>v0.0.1 · local demo</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
