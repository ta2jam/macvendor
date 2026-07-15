# Maintainer continuity and protected-main policy

The project currently has one effective maintainer. Two Git author names do not
constitute independent review. This bus factor cannot be fixed with automation,
a bot approval or a nominal contributor.

## Current control

- All normal changes enter `main` through a pull request.
- Required CI checks must pass and the branch must be current with `main`.
- Direct push, force push and deletion are blocked for administrators.
- Approval count is temporarily zero so the sole maintainer can merge after
  checks. This provides an auditable PR and CI boundary but not independent review.
- A P0 production incident may use only the documented repository emergency
  path; the bypass and follow-up evidence must be recorded.

## Closing bus factor 1

Raise required approvals to one only after a second trusted maintainer has:

- made reviewed, substantive contributions;
- demonstrated the API/data-rights and rollback boundaries;
- completed a synthetic staging deployment and restore drill;
- received least-privilege GitHub and production access without credential sharing;
- accepted incident, correction and data-decision responsibilities explicitly.

Until then, do not claim independent code review. Encrypted off-host backup,
immutable release artifacts and runbooks reduce recovery risk; they do not
replace a second accountable human.
