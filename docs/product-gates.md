# Product expansion gates

Accounts, paid plans, API keys, SDK repositories, unlimited bulk upload, and
microservices remain out of scope. They are not unfinished implementation work.

Reconsider them only when aggregate production evidence shows at least one of:

- repeat API consumers requesting stable client credentials;
- sustained legitimate 429 responses after measured quota tuning;
- repeated bulk requests exceeding the bounded 25-address endpoint;
- two or more independent requests for the same language SDK;
- a support/SLA obligation with a paying counterparty.

Until then, OpenAPI and JSON Schema are the client contract. Generated SDKs add
release, dependency, security, and support cost without demonstrated demand.
