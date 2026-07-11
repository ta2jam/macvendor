# Isolated HTTPS source fetch

Fetching and importing are deliberately separate commands:

```bash
npm run source:fetch -- --manifest path/to/manifest.json
npm run source:import -- --manifest path/to/manifest.json
```

`source:fetch` has no database access. It downloads into bounded temporary files,
checks the declared SHA-256 and Ed25519 signature, then atomically moves the
signature and artifact into their manifest-relative paths. `source:import`
remains an offline local-file parser and database writer. Deployment must run the
second phase without network egress.

IEEE preparation is a narrower reviewed workflow:

```bash
npm run source:prepare:ieee
```

It downloads only the three fixed official CSV URLs, pins raw hashes, signs the
raw bytes with the operator ingest key, writes manifests under ignored `.local/`,
and runs complete adapter/signature/schema validation before reporting success.
IEEE does not publish detached signatures, so `signature.origin` is `operator`;
this proves post-download custody, while the pinned HTTPS origin and raw hashes
preserve upstream provenance.

Normal IEEE operation uses the guarded end-to-end command instead of manually
chaining the phases:

```bash
OPERATOR_ACTOR_ID=operator:ieee-scheduler npm run source:update:ieee
```

It accepts the same `--output`, `--private-key`, and `--public-key` overrides as
the preparation command. The command has no scheduler dependency; deployment is
responsible for invoking it in UTC with jitter and alerting on non-zero exit.

## Remote manifest fields

```json
{
  "release": {
    "snapshotKind": "full_snapshot",
    "snapshotComplete": true,
    "schemaVersion": "1",
    "adapterVersion": "1",
    "normalizerVersion": "1",
    "diffPolicy": {
      "maxAddedPercent": 25,
      "maxRemovedPercent": 5
    }
  },
  "artifact": {
    "path": "records.csv",
    "format": "csv",
    "sha256": "sha256:...",
    "signatureStatus": "verified",
    "signature": {
      "algorithm": "ed25519",
      "path": "records.csv.sig",
      "publicKeyPath": "trusted-ed25519-public.pem",
      "publicKeySha256": "sha256:...",
      "url": "https://data.example.test/records.csv.sig"
    },
    "remote": {
      "url": "https://data.example.test/records.csv",
      "allowedOrigins": ["https://data.example.test"],
      "maxRedirects": 0
    }
  }
}
```

The public-key file is a reviewed local trust anchor. Its bytes must match
`publicKeySha256`; a remote response cannot select its own key.

## Network boundary

- URL, signature URL, and every redirect must use HTTPS.
- Credentials, query strings, and fragments are rejected rather than logged.
- Every origin and port must be explicitly allowlisted.
- Redirects are disabled with `maxRedirects=0` or bounded to at most three.
- DNS returns at most eight addresses; one non-public answer rejects the whole
  result.
- Loopback, private, shared, link-local, documentation, benchmark, multicast,
  reserved, and non-global IPv6 ranges are blocked.
- The validated IP is pinned into the TLS connection, while certificate hostname
  validation still uses the original hostname. This closes DNS re-resolution
  between validation and connect.
- TLS verification cannot be disabled by the CLI.
- Compressed responses are rejected. Declared and streamed size are bounded.
- Artifact and detached-signature fetches each have a 30-second wall deadline.

The private-address override exists only as an injected test option and throws
outside `NODE_ENV=test`; it is not exposed by the command line.

## Authenticity and change gates

Production releases require:

- `signatureStatus=verified` plus an Ed25519 detached signature;
- a complete full snapshot;
- an explicit `diffPolicy`;
- the existing rights and privacy gates.

Production deltas are rejected until deterministic base-snapshot materialization
is implemented. Treating a partial delta as a complete resolver input would
silently withdraw unchanged assignments.

For every later full snapshot, normalized record hashes are compared with the
most recent valid release. Added and removed percentages must stay inside the
manifest thresholds. A breach aborts the transaction and creates no partial
release. Duplicate normalized rows and multiple authoritative assignments for
the same registry/prefix are rejected before the database transaction.

## Cost model

Network and signature work is `O(B)` time and memory for at most 20 MiB artifact
bytes. Parsing is `O(B + R)` and keeps at most 250,000 normalized records. Diff
validation is `O(R + P)` memory/time for current and previous record-hash sets.
These constants must be benchmarked before admitting a large production source.
