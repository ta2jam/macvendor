# IEEE Registration Authority data-rights review

Review date: 2026-07-11

Next mandatory review: 2027-07-11
Status: **approved with recorded residual risk for derived public API output**

This is an engineering and owner risk-acceptance record, not legal advice or an
IEEE endorsement.

## Intended use

macvendor periodically retrieves the IEEE Registration Authority MA-L, MA-M,
and MA-S public CSV listings directly from `standards-oui.ieee.org`, stores an
immutable hash-pinned operator-signed snapshot, normalizes assignment rows, and
returns selected prefix and organization fields through the public lookup API.
Raw or bulk IEEE dataset redistribution is not approved by this decision.

## Evidence chain

1. The current IEEE Registration Authority page explicitly offers complete CSV
   downloads for MA-L, MA-M, MA-S, IAB, and CID public listings:
   <https://standards.ieee.org/products-programs/regauth/>.
2. A 2013 IEEE response preserved by Debian stated that IEEE did not issue
   licenses for third-party distribution of the public listing. This is adverse
   evidence and is retained rather than omitted:
   <https://lists.debian.org/debian-legal/2013/08/msg00003.html>.
3. Debian's current machine-readable copyright record preserves a later 2014
   IEEE clarification: IEEE does not assert copyright in the OUI Public Listing
   and does not attempt to restrict its distribution. Debian applies that record
   to `iab.*`, `mam.*`, `oui36.*`, and `oui.*`:
   <https://metadata.ftp-master.debian.org/changelogs/main/i/ieee-data/unstable_copyright>.
4. Debian continues to distribute the data in `main`; its current package is
   built from direct IEEE listings: <https://packages.debian.org/sid/ieee-data>.
5. The Free Software Directory records the same 2014 clarification as a public
   domain claim: <https://directory.fsf.org/wiki/Ieee-data>.

The 2014 statement is preserved through Debian's reviewed package metadata, not
on a currently discoverable IEEE-hosted license page. The general IEEE website
footer still says “all rights reserved.” These facts create residual ambiguity;
they do not erase the later dataset-specific clarification.

## Decision 2026-07-11

The repository owner explicitly accepted the residual legal risk on 2026-07-11.
For macvendor's engineering gates, MA-L, MA-M, and MA-S are therefore classified
as:

- `rights_status=approved`;
- `rights_basis=public_domain_claim`;
- `distribution_scope=api_output`;
- `rights_review_reference=docs/rights/ieee-registration-authority.md#decision-2026-07-11`.

This approval covers derived lookup responses only. It does not approve a raw
download endpoint, third-party mirrors, IAB/CID ingestion, IEEE logo use, or a
claim that IEEE sponsors or certifies macvendor.

## Mandatory controls

- Retrieve only the three fixed official HTTPS CSV URLs; do not use KIT,
  GitHub mirrors, Debian package payloads, or commercial lookup services as the
  production source.
- Pin every raw artifact with SHA-256 and sign it with the operator Ed25519
  ingest key before import. The private key remains outside the repository.
- Preserve source URL, fetch time, byte count, raw hash, adapter version,
  normalization version, and validation warnings in the immutable release.
- Reject schema, registry, prefix-width, signature, hash, origin, rights, and
  full-snapshot diff changes.
- Omit every ambiguous duplicate prefix rather than selecting a silent winner.
  The 2026-07-11 MA-L snapshot omits `0001C8` and `080030` and records the source
  row numbers in `adapterWarnings`.
- Normalize control and invisible characters deterministically while retaining
  the raw signed artifact.
- Display assignment-owner semantics and the no-device-identification
  disclaimer. Keep IEEE and curated claims separate.
- Refresh from IEEE regularly, expose data age, and re-run this rights review by
  2027-07-11 or immediately if IEEE publishes conflicting terms.
- On revocation or credible dispute, block new builds and use the audited
  suppression/rollback process.

Issue [#8](https://github.com/ta2jam/macvendor/issues/8) may close only after the
adapter, real import, deterministic resolution, lookup tests, and release gates
pass.
