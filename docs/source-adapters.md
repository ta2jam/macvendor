# Source adapter contract

Adapters translate one reviewed upstream row shape into macvendor's strict raw
record contract. They do not grant data rights, select production status, relax
privacy checks, or execute code named by a manifest.

## Registry boundary

`src/importer/adapters/registry.ts` is the only adapter allowlist. Registration
is compile-time; manifests cannot load a package, module path, URL, expression,
or runtime plugin. Each adapter declares:

- one stable `key`;
- explicit supported `adapterVersion` values;
- any source slugs exclusively owned by that adapter;
- a manifest validator;
- a deterministic row transform returning rows and bounded JSON warnings.

V1 transforms may preserve or reduce row count but cannot expand it. Raw input,
adapted output, warning count, and serialized warnings are bounded before any
database transaction. A future range-expansion adapter requires a separately
reviewed streaming/materialization design rather than allocating an unbounded
array inside the importer.

Every output row must inherit one unique, unforgeable-in-manifest source-row
locator from its input row. Filtering therefore does not renumber provenance;
`rawLocator` continues to identify the original parsed upstream row. Missing,
fabricated, or duplicated locators reject the adapter result.
This locator-preserving behavior is record normalizer v2; changing normalized
record semantics again requires another version and new immutable import keys.

Unknown keys, unsupported versions, and use of a reserved source slug through a
different adapter fail before artifact parsing. All adapted rows still pass the
same field, prefix, rights, privacy, duplicate, size, signature, diff, and
production gates. An adapter cannot mark a source reviewed or bypass those
checks. Release `schemaVersion` and `normalizerVersion` are also restricted to
versions actually implemented by the runtime; a manifest cannot create a new
behavior merely by claiming a higher version string.

## Contributor workflow

1. Open a focused data-source proposal with provenance, rights scope, update
   method, expected size, privacy classification, and representative schema.
2. Keep fixtures synthetic or redistribution-approved. Never commit a copied
   third-party dataset merely to make a test pass.
3. Implement a pure deterministic adapter under `src/importer/adapters/` and
   register it once in the compile-time registry.
4. Bind source-specific slugs and adapter versions. Reject schema drift rather
   than guessing columns or silently dropping malformed rows.
5. Add golden, malformed-header, malformed-row, duplicate, warning-bound, and
   resource-limit tests.
6. Validate the complete local fixture without database access:

```bash
npm run source:validate -- --manifest path/to/manifest.json
```

7. Run `npm run verify`. Production admission additionally requires the rights,
   privacy, signature, full-snapshot, and diff-policy reviews documented in
   [`governance.md`](governance.md).

The validation command reads only the manifest, trust anchor, signature, and
artifact. It performs no network request and no database write. Successful
validation means the fixture satisfies parser contracts; it is not a licensing
approval or production activation.
