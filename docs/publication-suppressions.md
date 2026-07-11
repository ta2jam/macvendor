# Correction references and publication suppressions

Suppression is a temporary publication overlay. It never deletes or edits source
records, resolution outputs, or earlier audit events.

The database stores only opaque ticket references such as `CORR-1042`. Do not
put names, email addresses, message bodies, IP addresses, or other requester
contact data in a ticket reference, reason code, actor ID, or source slug. The
correction system that owns the ticket remains outside PostgreSQL.

## Create

Set an opaque operator identity and choose exactly one target:

```bash
OPERATOR_ACTOR_ID=operator:alice npm run suppression:create -- \
  --assignment UUID --reason correction_review --ticket CORR-1042

OPERATOR_ACTOR_ID=operator:alice npm run suppression:create -- \
  --claim UUID --reason correction_review --ticket CORR-1043 \
  --expires-at 2026-07-12T10:00:00Z

OPERATOR_ACTOR_ID=operator:alice npm run suppression:create -- \
  --prefix 02AABB-24 --surface both --source demo-authoritative \
  --reason legal_review --ticket LEGAL-1044
```

Assignment and claim IDs must belong to the active resolution. Prefix targets
are scoped to the current resolution and require `official`, `curated`, or
`both`. A source filter is optional but must name a source in the active input
set.

## List, revoke, and expire

```bash
npm run suppression:list -- --status active

OPERATOR_ACTOR_ID=operator:alice npm run suppression:revoke -- \
  --id UUID --ticket CORR-1042-REVOKE

OPERATOR_ACTOR_ID=operator:expiry-job npm run suppression:expire
```

The expiry command marks every due active suppression expired. Run it at a
fixed operational interval shorter than the public cache lifetime.

## Transaction and cache behavior

Create, revoke, and non-empty expire operations:

1. acquire the publication advisory lock;
2. lock the active-resolution pointer;
3. validate and change suppression state;
4. increment `publicationVersion`;
5. append an immutable audit event;
6. commit all steps together.

Concurrent attempts for the same target serialize. A partial suppression without
a version bump cannot commit. API ETags include `publicationVersion`, so every
successful state change invalidates the response variant deterministically.
PostgreSQL rejects `UPDATE` and `DELETE` against `audit_events`; corrections are
represented by new events.

`list` is bounded to 1,000 rows. Mutation cost is `O(1)` plus indexed checks;
expiry is `O(E)` for `E` due rows and writes one audit event per row.
