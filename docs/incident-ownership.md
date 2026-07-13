# Production ownership and incident boundaries

The repository owner is the accountable production operator and data-decision
owner for macvendor.io. Automated jobs may detect, quarantine, suppress, or
report a condition only within their documented policy; they do not invent a
legal, privacy, or source-rights decision.

## Channels and systems of record

- Slack `#team` receives production failure and recovery transitions.
- The encrypted `correction_requests` and append-only `correction_events`
  tables are the correction queue system of record at the current volume.
- GitHub private security advisories are the only public security-report route.
- GitHub issues must not contain credentials, private evidence, personal contact
  details, or unredacted correction submissions.

## Decision ownership

| Event | Automation | Human decision owner |
|---|---|---|
| Public/API health failure | Alert and preserve the last healthy release | Production operator |
| Source freshness or rights failure | Block activation and alert | Data-decision owner |
| Correction SLA breach | Fail the hourly health unit and alert | Correction operator |
| Privacy, rights, or withdrawal request | Encrypt, queue, and provide a reference | Data-decision owner |
| Suspected credential exposure | Block release through scanning | Production operator |

The production operator and data-decision owner are currently the same
repository-owner role. Splitting those roles is a capacity trigger, not hidden
unfinished work: do it before granting another person production or correction
decryption access.

## Response boundaries

- A correction submission never edits a release automatically.
- Emergency visibility changes use an audited suppression with a ticket
  reference; durable changes use a new governed release.
- No one acknowledges an incident as resolved until the failing check passes
  and the public surface is verified.
- Slack is a notification path, not the audit record or correction database.
