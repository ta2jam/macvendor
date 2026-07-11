# IEEE Registration Authority data-rights review

Review date: 2026-07-11

Status: **blocked — no production use approved**

This is an engineering gate, not legal advice. It records the evidence required
by macvendor before IEEE Registration Authority data can enter a production
release.

## Intended use

macvendor would periodically fetch MA-L, MA-M, and MA-S public-listing files,
normalize assignments, cache the derived data, and return organization and
prefix fields through a public API. Raw database download is not planned for V1.

## Evidence reviewed

- IEEE SA identifies itself as the registry owner and provides full public-listing
  downloads for MA-L, MA-M, MA-S, IAB, and CID:
  <https://standards.ieee.org/products-programs/regauth/>.
- The linked MA-L, MA-M, and MA-S CSV files contain only a field header and data
  rows. No license, permission grant, attribution rule, or API-output scope was
  present in the downloaded artifacts on the review date.
- The IEEE MA-L product page describes assignment use and public display, but it
  does not grant third parties permission to copy, transform, cache, or expose
  the public listing through another API:
  <https://standards.ieee.org/products-programs/regauth/oui/>.
- The KIT NETVS lookup is a reference implementation/consumer, not the owner of
  IEEE assignment rights. Its availability cannot license IEEE data for
  macvendor: <https://netvs.scc.kit.edu/tools/oui_lookup>.

“Public listing” and “downloadable” establish access, not redistribution or
commercial/public API rights. No open-data or Creative Commons license was found
on the registry page or in the three candidate CSV artifacts.

## Decision

The candidate remains `reference`/QA-only. Do not create an IEEE production
manifest, import an IEEE artifact as production, publish derived IEEE rows, or
describe IEEE data as open/public-domain. GitHub mirrors and KIT are not
alternative rights sources.

Issue [#8](https://github.com/ta2jam/macvendor/issues/8) remains open and
blocked. Code, attribution, or a disclaimer cannot replace permission.

## Evidence required to unblock

Obtain a written IEEE license or permission that explicitly covers:

1. automated periodic retrieval of the MA-L, MA-M, and MA-S listings;
2. local storage, normalization, combination, and cache/CDN copies;
3. public API output, including commercial use if macvendor may monetize;
4. permitted fields and whether raw or bulk output is prohibited;
5. mandatory attribution, trademark, link-back, and disclaimer text;
6. update-frequency, request-rate, termination, revocation, and deletion duties;
7. geographic, sublicensing, downstream-user, and retention limits.

The approval record must name the reviewer, evidence reference, allowed
distribution scope, effective date, expiry/review date, and revocation response.
Until then, synthetic data is the only authoritative-looking data allowed in
local demonstrations.
