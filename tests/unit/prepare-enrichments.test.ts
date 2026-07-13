import { describe, expect, it } from "vitest";
import {
  rangeToPrefixes,
  runZeroVirtualRecords,
  VIRTUAL_PLATFORM_RIGHTS_BASIS,
} from "../../src/sources/prepare-enrichments";

describe("enrichment source preparation", () => {
  it("converts inclusive EUI-48 ranges into a minimal deterministic CIDR cover", () => {
    expect(rangeToPrefixes(0x01005e900100n, 0x01005e9001ffn)).toEqual([
      { bits: 0x01005e9001n, length: 40 },
    ]);
    expect(rangeToPrefixes(0x01005e900100n, 0x01005e900102n)).toEqual([
      { bits: 0x01005e900100n >> 1n, length: 47 },
      { bits: 0x01005e900102n, length: 48 },
    ]);
  });

  it("extracts only explicit runZero virtual prefix declarations", () => {
    const source = `"505400000000/24": {Oui: []byte{}, Mask: 24, Vendor: "QEMU", Added: "2003-03-18", Virtual: VirtTypeQEMU},`;
    expect(runZeroVirtualRecords(source)).toEqual([
      expect.objectContaining({ prefix: "505400", prefixLength: "24", recordKind: "device_hint",
        organizationName: "QEMU", claimValue: { platform: "QEMU", vendor: "QEMU", added: "2003-03-18" } }),
    ]);
  });

  it("keeps virtual-platform rights aligned with approved production governance", () => {
    expect(VIRTUAL_PLATFORM_RIGHTS_BASIS).toEqual({
      hyperv: "public_domain_claim",
      vmware: "public_domain_claim",
      openstack: "licensed",
    });
  });
});
