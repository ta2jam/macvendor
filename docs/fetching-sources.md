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

It downloads only the five fixed official CSV URLs, pins raw hashes, signs the
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
    "normalizerVersion": "2",
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
- Each validated IP is pinned into its own TLS attempt, while certificate
  hostname validation still uses the original hostname. This closes DNS
  re-resolution between validation and connect.
- Transient transport failures, ten seconds without network progress, and HTTP
  408, 425, 500, 502, 503, or 504 responses fail over sequentially to the next
  validated DNS address within the original wall deadline. HTTP 429 is not
  failed over because switching addresses could bypass an origin-wide rate
  limit. Other 4xx/5xx responses, security-policy violations, size breaches,
  hash/signature failures, and parser errors are not retried.
- Fetch errors include the governed source slug, sanitized origin/path, HTTP
  status when available, and bounded address-attempt count. Query strings and
  credentials remain rejected before that context can be emitted.
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

For artifact size `B` and at most eight validated DNS addresses `A`, network
transfer is `O(A * B)` worst-case and memory remains `O(B)` because attempts are
sequential and capped by the unchanged wall deadline. Parsing is `O(B + R)` and
keeps at most 250,000 normalized records. Diff validation is `O(R + P)`
memory/time for current and previous record-hash sets. These constants must be
benchmarked before admitting a large production source.
