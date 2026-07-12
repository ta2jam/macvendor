# Virtual-platform MAC hint rights and correctness

## Decision — 2026-07-12

Microsoft Hyper-V and VMware records are small factual allocation rules reviewed
from the vendors' public documentation. OpenStack Neutron defaults are derived
from its Apache-2.0 source. Only the facts and source links are stored; vendor
documentation text is not copied.

These records are non-authoritative `device_hint` values. Every listed prefix
can be manually configured, reused, or spoofed, so API output must say
`possible`, never identify a device or operating system with certainty. Review
expires 2027-07-12.

- https://learn.microsoft.com/en-us/troubleshoot/windows-server/virtualization/default-limit-256-dynamic-mac-addresses
- https://knowledge.broadcom.com/external/article/316642
- https://opendev.org/openstack/neutron/src/branch/master
