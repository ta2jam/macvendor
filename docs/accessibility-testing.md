# Accessibility and cross-browser verification

macvendor treats accessibility as a release gate, not a conformance claim.
Automated checks catch a useful subset of defects; they do not prove WCAG 2.2
AA compliance or replace testing with disabled users and assistive technology.

## Automated gate

Playwright runs the public pages and lookup flows in:

- Chromium desktop;
- Firefox desktop;
- WebKit desktop;
- Chromium at a 320 px mobile viewport.

The suite checks WCAG A/AA axe rules, landmark/headline structure, skip-link
focus, labelled form controls, success/no-match/error states, mobile navigation,
and document-level horizontal overflow. Screenshots, traces, video, and an HTML
report are retained only on CI failure.

Prepare a synthetic test database, build, install the pinned browser binaries,
and run:

```bash
npm run db:test:prepare
npm run build
npm run browser:install
DATABASE_URL="$TEST_DATABASE_URL" npm run test:browser
```

`DATABASE_URL` must point to the disposable test database. Browser tests never
authorize or import IEEE or amateur data.

## Manual release checklist

- keyboard-only traversal at 320 px and desktop width;
- visible focus for skip link, navigation, form, demo control, and JSON output;
- 200% browser zoom without loss of content or two-dimensional page scrolling;
- VoiceOver/NVDA reading order and async status/error announcements;
- forced-colors/high-contrast mode and reduced-motion behavior;
- Turkish and English text pronunciation/meaning review;
- touch targets and real mobile Safari viewport behavior.

Playwright WebKit on macOS does not emulate the operating-system “Press Tab to
highlight each item” setting. The automated WebKit project focuses the skip link
before testing Enter activation; real Safari Tab traversal remains a mandatory
manual check.

Manual observations must name the browser, OS, assistive technology/version,
viewport/zoom, date, and tester. Unperformed checks remain unverified; they are
not silently marked as passed.
