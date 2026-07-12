# Wikidata vendor-alias rights and identity review

Review date: 2026-07-12

Next mandatory review: 2027-07-12

## Evidence

Wikidata structured data is published under CC0:
<https://www.wikidata.org/wiki/Wikidata:Licensing>.

## Decision 2026-07-12

Only QIDs in `config/wikidata-alias-mappings.json` may enter production. Each
mapping lists exact IEEE registered names and is operator-reviewed. Fuzzy name
matching is prohibited. English labels and aliases are emitted as a separate
`vendor_alias` layer, never as an IEEE assignee replacement. A new QID or
registered-name variant requires review and a committed mapping change.
