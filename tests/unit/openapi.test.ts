import { describe, expect, it } from "vitest";
import openapi from "../../public/openapi.json";
import { assertPublicContract } from "../helpers/contracts";

describe("OpenAPI 3.1 publication", () => {
  it("directs clients only to the maintained public service", () => {
    expect(openapi.servers).toEqual([
      { url: "https://macvendor.io", description: "Maintained public service" },
    ]);
  });

  it("documents every public v1 endpoint", () => {
    expect(openapi.openapi).toBe("3.1.1");
    expect(Object.keys(openapi.paths).sort()).toEqual([
      "/v1/assignments/{registry}/{prefix}",
      "/v1/corrections",
      "/v1/data-release",
      "/v1/data-release/changes",
      "/v1/lookup/{mac}",
      "/v1/lookups",
      "/v1/organizations",
      "/v1/organizations/{key}",
    ]);
    expect(openapi.paths["/v1/lookup/{mac}"].get.responses["308"]).toBeDefined();
    expect(openapi.paths["/v1/assignments/{registry}/{prefix}"].get.responses["308"]).toBeDefined();
  });

  it("uses the public schema bundle for every JSON response", () => {
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/LookupResponse");
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/AssignmentResponse");
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/DataReleaseResponse");
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/BulkLookupResponse");
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/ReleaseChangesResponse");
    expect(JSON.stringify(openapi)).toContain("/schemas/public-api-v1.schema.json#/$defs/Problem");
  });

  it("locks stable problem code and HTTP status pairs", () => {
    assertPublicContract("Problem", {
      type: "https://macvendor.io/problems/invalid-mac",
      title: "Invalid MAC address",
      status: 400,
      code: "INVALID_MAC",
      detail: "Synthetic invalid input.",
      requestId: "contract-test",
    });
    expect(() => assertPublicContract("Problem", {
      type: "https://macvendor.io/problems/invalid-mac",
      title: "Invalid MAC address",
      status: 503,
      code: "INVALID_MAC",
      detail: "Synthetic invalid input.",
      requestId: "contract-test",
    })).toThrow(/contract drift/);
  });
});
