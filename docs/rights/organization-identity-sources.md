# Organization identity source rights

All sources in this document are restricted to manually reviewed identifiers in
`config/organization-identity-mappings.json`. Full third-party datasets are not
published or retained by the API. They never replace IEEE assignment owners.
Review expires 2027-07-12.

## IANA PEN

IANA protocol registries are dedicated under CC0. Only the PEN number and
organization field are used; contact names and email addresses are discarded.

## PCI IDs

The PCI ID Repository permits distribution under GPL-2.0-or-later or
BSD-3-Clause. macvendor selects BSD-3-Clause and publishes only reviewed vendor
identifier/name facts with attribution.

## USB IDs

The upstream USB ID endpoint had an invalid TLS certificate during the review.
The production adapter therefore uses the actively maintained `hwdata` mirror
under GPL-2.0-or-later and records that source explicitly rather than silently
bypassing TLS validation.

## GLEIF

GLEIF LEI data is provided under CC0. Only explicitly mapped LEIs are fetched;
legal-name similarity does not create a mapping.

## SEC EDGAR

SEC submissions data is public US government data. Only reviewed CIK records
are fetched through `data.sec.gov`; the adapter follows SEC fair-access rules
and does not crawl filings.

## Companies House

Reviewed UK company records are fetched from the official company URI service
under the Open Government Licence v3. Attribution is required. Subsidiaries are
kept as separate organization keys and are not silently merged into parents.
