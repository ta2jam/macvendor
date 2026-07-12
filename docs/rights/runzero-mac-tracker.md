# runZero mac-tracker rights and provenance review

Review date: 2026-07-12

Next mandatory review: 2027-07-12

## Evidence and boundary

The repository publishes an MIT license covering its software and associated
documentation: <https://github.com/runZeroInc/mac-tracker/blob/main/LICENSE>.
Its historical dataset was bootstrapped from older Wireshark and DeepMAC
snapshots, so the MIT notice is not treated as proof that historical facts are
independently authoritative.

## Decision 2026-07-12

The data is approved only as a separately attributed enrichment source:

- historical names become `vendor_alias` observations;
- the reviewed `oui_virtual.go` entries become probabilistic `device_hint`
  records;
- neither may overwrite or corroborate an IEEE assignment;
- the raw aggregate is not redistributed;
- every response retains the runZero source reference and verification level.

This is a licensed-source decision with explicit provenance risk, not an
authoritative assignment classification.
