# Source adapter fixture

This directory is the minimum reviewable contribution shape for a governed data source.

1. Replace the synthetic row in `records.jsonl` with non-personal source records.
2. Update `manifest.example.json`; never claim a licence or permission without stable evidence.
3. Keep identity assertions separate from MAC assignments. Do not fuzzy-merge organizations.
4. Sign the artifact with a contributor-controlled Ed25519 key.
5. Run `npm run source:validate -- --manifest /absolute/path/to/manifest.json`.

Fixtures are synthetic and are never imported into production.
