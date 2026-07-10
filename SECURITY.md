# Security policy

## Supported versions

| Version | Security fixes |
|---|---|
| Latest `0.0.x` | Best effort |
| Older versions | Not supported |

This policy will become stricter before `1.0.0`.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for
[`ta2jam/macvendor`](https://github.com/ta2jam/macvendor/security/advisories/new).
Include:

- affected version and environment;
- minimal reproduction;
- expected and observed boundary;
- impact and attacker prerequisites;
- relevant request ID without secrets or personal data;
- suggested mitigation, if known;
- whether public credit is desired.

An acknowledgement is targeted within 72 hours. No bounty is currently offered.
Disclosure timing will be coordinated after impact and remediation are clear.

## High-priority scope

- SQL injection, SSRF, path traversal, or unsafe redirect behavior;
- cross-release or suppression bypass;
- public exposure of exact/private MAC evidence or correction-ticket data;
- rights/provenance bypass that publishes an ineligible source;
- cache confusion serving a suppressed or different release;
- rate-limit trust-boundary bypass at the origin;
- migration, seed, or test tooling that can target a non-test database contrary
  to its documented guard;
- release, dependency, or repository supply-chain compromise.

## Current boundary

The `0.0.x` release is a local/demo implementation and uses synthetic records.
It has not completed a production deployment, external penetration test, or
formal privacy/legal review. The in-process rate limiter is a fallback, not a
distributed edge control. Production ingest remains blocked on source rights.

Do not place secrets in `.env.example`, issues, logs, fixtures, screenshots, or
source manifests. `.env.local` is ignored by Git but still plaintext local data.
