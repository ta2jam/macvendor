import type { Metadata } from "next";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
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
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <header className="site-header">
          <div className="shell header-inner">
            <Link className="brand" href="/" aria-label="macvendor.io home">
              <span className="brand-mark" aria-hidden="true">M</span>
              <span>macvendor<span>.io</span></span>
            </Link>
            <nav aria-label="Main navigation">
              <Link href="/methodology">Methodology</Link>
              <Link href="/data-sources">Sources</Link>
              <Link href="/data-release">Data release</Link>
              <Link href="/data-corrections">Corrections</Link>
              <Link href="/api-docs">API</Link>
            </nav>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>{children}</main>
        <footer>
          <div className="shell footer-grid">
            <div className="footer-copy">
              <p>
                Results show address-block registrations and separate owner-curated claims; they do not
                prove a device&apos;s actual manufacturer, model, or owner.
              </p>
              <div className="footer-links" aria-label="Data governance links">
                <Link href="/legal/data-terms">Data terms</Link>
                <Link href="/data-corrections">Report a correction</Link>
              </div>
            </div>
            <span>v{APP_VERSION} · local demo</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
