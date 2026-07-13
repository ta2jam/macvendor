# Owner-created source quarantine

This fixture demonstrates the intake boundary for owner-created or amateur
datasets. `owner:prepare` always emits a `qa_only`, `internal_only` manifest.
It cannot publish records or replace an IEEE assignment.

```bash
npm run owner:prepare -- \
  --declaration examples/owner-source/declaration.example.json \
  --records examples/owner-source/records.jsonl \
  --output .local/owner-source-example
```

Production promotion is a separate, audited governance decision after rights,
privacy, conflict, sampling, signature, correction-contact, and rollback review.
No source is removed or disabled as part of this intake.
