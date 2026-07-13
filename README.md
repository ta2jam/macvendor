<div align="center">

# macvendor

**Source-aware MAC address block assignment lookup.**

Use the maintained public service at **[macvendor.io](https://macvendor.io/)**.

[Web lookup](https://macvendor.io/) · [API reference](https://macvendor.io/api-docs) ·
[Service status](https://macvendor.io/status) · [Data sources](https://macvendor.io/data-sources) ·
[Data terms](https://macvendor.io/legal/data-terms)

[![CI](https://github.com/ta2jam/macvendor/actions/workflows/ci.yml/badge.svg)](https://github.com/ta2jam/macvendor/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/ta2jam/macvendor)](CHANGELOG.md)
[![License](https://img.shields.io/github/license/ta2jam/macvendor)](LICENSE)

</div>

> [!IMPORTANT]
> A MAC lookup identifies the registrant of an address block. It does **not**
> prove a device's manufacturer, model, owner, location, authenticity, or
> current network identity. MAC addresses can be reassigned, spoofed, and
> randomized.

## Use the service

The web interface is the fastest way to inspect one address:

**[Open the macvendor.io lookup](https://macvendor.io/)**

macvendor keeps authoritative registry assignments, reviewed enrichment, source
provenance, and release state separate. It does not collapse them into an
unverifiable “device manufacturer” string.

A result can include:

- the longest matching authoritative MA-S, MA-M, MA-L, or legacy IAB assignment;
- separate reviewed claims and usage insights that never overwrite that assignment;
- local-administered and multicast flags without changing the submitted address;
- the source release, active data version, and publication version used to answer.

No match is a valid result: the API returns `200` with `assignment: null`.

## Public API

Base URL: `https://macvendor.io/v1`

The public API currently requires no API key. Use HTTPS, respect rate limits,
and do not send credentials or unrelated personal data in requests.

| Endpoint | Purpose |
|---|---|
| `GET /v1/lookup/{mac}` | Assignment, separate reviewed claims, and release metadata |
| `GET /v1/lookup/{mac}?mode=official` | Authoritative assignment layer only |
| `POST /v1/lookups` | Bounded official lookup for 1–25 addresses |
| `GET /v1/assignments/{registry}/{prefix}` | Exact active registry assignment |
| `GET /v1/data-release` | Active release, sources, rights state, and hashes |
| `GET /v1/data-release/changes` | Aggregate changes from the preceding release |
| `GET /v1/organizations` | Reviewed organization search and filters |

Single lookup:

```bash
curl --fail --silent --show-error --location \
  'https://macvendor.io/v1/lookup/00000C123456'
```

Authoritative layer only:

```bash
curl --fail --silent --show-error \
  'https://macvendor.io/v1/lookup/00000C123456?mode=official'
```

Bounded bulk lookup:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"macs":["00000C123456","001122334455"]}' \
  'https://macvendor.io/v1/lookups'
```

The machine-readable contracts are published by the service:

- [OpenAPI 3.1](https://macvendor.io/openapi.json)
- [Public JSON Schema](https://macvendor.io/schemas/public-api-v1.schema.json)
- [Active data release](https://macvendor.io/v1/data-release)

## Integrate safely

- Accept the documented bare, colon, hyphen, or dotted EUI-48 forms. Canonical
  lookup paths use 12 uppercase hexadecimal characters.
- Follow `308 Permanent Redirect` responses or send canonical paths directly.
- Treat `assignment: null` as a successful no-match result, not as a transport
  failure.
- Keep `assignment`, `curatedMatches`, and `insights` semantically separate.
  Never present a reviewed hint as an authoritative registration.
- Preserve release metadata when results are stored or audited. Registry data
  and enrichment can change between publications.
- Honor `429 Retry-After`; use bounded exponential backoff for transient `503`
  responses and set client-side connection/read timeouts.
- Use `ETag` and `If-None-Match` for repeated GET requests instead of polling
  full responses unnecessarily.
- Keep bulk requests at or below 25 addresses. Do not parallelize requests to
  evade service limits.
- Do not use a MAC result as the sole basis for authentication, authorization,
  fraud decisions, surveillance, or device attribution.

Errors use RFC 9457 `application/problem+json` and include an `X-Request-Id`.
Log that identifier when reporting a reproducible service problem, but avoid
logging unnecessary raw MAC addresses in privacy-sensitive environments.

## Data and accuracy boundary

macvendor distinguishes data availability from data rights and confidence:

- authoritative assignments and enrichment remain separate layers;
- every active source exposes provenance and release metadata;
- unreviewed or rights-unclear rows cannot enter the public production release;
- exact device-level claims are not public by default;
- correction and suppression processes do not silently rewrite source history.

Review the live [source inventory](https://macvendor.io/data-sources),
[methodology](https://macvendor.io/methodology), and
[data-use terms](https://macvendor.io/legal/data-terms) before using results in
a product or dataset.

## Corrections and security

Use [Report a correction](https://macvendor.io/data-corrections) for incorrect
assignments, reviewed claims, privacy requests, or data-rights concerns.

Do not disclose suspected vulnerabilities in a public issue. Use
[GitHub private vulnerability reporting](https://github.com/ta2jam/macvendor/security/advisories/new)
and follow [`SECURITY.md`](SECURITY.md).

## Open source

macvendor is open-source software licensed under the
[MIT License](LICENSE). Development is public for transparency, review, and
focused contributions; the maintained service for users and API clients is
[macvendor.io](https://macvendor.io/).

Bug reports, narrowly scoped improvements, and well-evidenced source proposals
are welcome through [GitHub Issues](https://github.com/ta2jam/macvendor/issues).
Source-code licensing does not grant rights to third-party MAC assignment or
vendor data.
