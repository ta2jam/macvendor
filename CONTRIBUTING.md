# Contributing to macvendor

macvendor is early. Contributions that improve correctness, provenance,
privacy, deterministic releases, or measured hot-path performance are more
valuable than adding broad product surface.

## Before opening code

- Search [existing issues](https://github.com/ta2jam/macvendor/issues) first.
- Use [Discussions](https://github.com/ta2jam/macvendor/discussions) for
  open-ended design questions.
- Report vulnerabilities through [private vulnerability reporting](SECURITY.md),
  never a public issue.
- Small, isolated fixes can go directly to a pull request. Large schema, API,
  resolver, source-policy, or privacy changes need an issue first.
- A dataset proposal must use the data-source issue template and include rights
  and provenance evidence. “Publicly downloadable” is not a license.

## Development setup

```bash
git clone https://github.com/ta2jam/macvendor.git
cd macvendor
createdb macvendor_dev
createdb macvendor_test
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:seed
npm run verify
```

The demo dataset is synthetic. Do not add copied IEEE or third-party records to
fixtures, snapshots, examples, or screenshots without documented permission.

## Engineering rules

- An address-block registrant is not automatically the physical device vendor.
- Authoritative assignments and owner-curated claims remain separate.
- U/L and I/G input bits are reported, not silently changed.
- CID is not part of full-MAC lookup.
- Data releases are immutable; activation uses the atomic pointer.
- New source or claim types require provenance, rights, privacy, and deletion
  semantics before code.
- Unknown origin or rights cannot enter production output.
- Use parameterized SQL. Do not interpolate input into SQL, paths, or shell
  commands.
- Add failure-path and regression tests, not only happy paths.
- State time complexity, query-count changes, memory, I/O, and cache impact when
  changing lookup or ingestion paths.
- Do not claim “optimal”, “official”, “private”, or “verified” without a
  measurable contract and evidence.
- Keep dependencies and operational components small; justify every new one.

The binding constraints are in [`docs/`](docs/).

## Database migrations

Applied migration files are immutable. Add a new sequential
`NNNN_lowercase_name.sql` file; never edit, rename, or delete an existing one.
Add the exact `sha256:<64 lowercase hex>` digest to
`migrations/checksums.json`, then run:

```bash
npm run db:migrations:verify
npm run test:integration
```

The ledger must cover the exact SQL filename set. Changing both an applied SQL
file and its ledger entry still fails against the checksum already stored in
deployed database history. Drift requires a forward migration, not history
rewriting.

## Pull requests

A pull request must contain:

- a focused problem statement;
- the smallest relevant change;
- tests proving the behavior or regression;
- schema, API, security, privacy, and compatibility impact;
- hot-path query/time/memory impact when relevant;
- documentation for user-visible behavior;
- no unrelated formatting, generated output, secrets, or third-party data.

Run before opening the pull request:

```bash
npm run verify
npm run browser:install
DATABASE_URL="$TEST_DATABASE_URL" npm run test:browser
npm audit --audit-level=low
```

The project does not require a CLA. By contributing, you agree that your code is
licensed under MIT and that any submitted data has the rights stated in the
proposal.

## Version and release policy

Every released version is represented by an explicit commit and annotated tag.

1. Choose the SemVer version from the actual compatibility impact.
2. Update `package.json` and `package-lock.json` together.
3. Move relevant `Unreleased` entries in `CHANGELOG.md` under the dated version.
4. Update user-visible version references if present.
5. Run `npm run verify` and `npm audit --audit-level=low`.
6. Commit all release changes with `release: vX.Y.Z`.
7. Create `git tag -a vX.Y.Z -m "macvendor vX.Y.Z"` from that commit.
8. Push the commit and tag; publish release notes from the changelog.

Version-only changes must never remain uncommitted. A tag must not point to a
commit whose package/changelog version differs, and a release must not be made
from a dirty working tree.
