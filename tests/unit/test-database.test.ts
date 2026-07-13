import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "../../scripts/test-database";

describe("destructive test database boundary", () => {
  it("accepts only local _test databases by default", () => {
    expect(assertTestDatabaseUrl("postgresql://localhost:5432/macvendor_test").pathname)
      .toBe("/macvendor_test");
    expect(() => assertTestDatabaseUrl("postgresql://localhost:5432/macvendor"))
      .toThrow("ends with _test");
    expect(() => assertTestDatabaseUrl("postgresql://db.example.org/macvendor_test"))
      .toThrow("TEST_DATABASE_ALLOW_REMOTE");
  });

  it("requires explicit opt-in for a remote disposable database", () => {
    expect(assertTestDatabaseUrl("postgresql://db.example.org/macvendor_test", true).hostname)
      .toBe("db.example.org");
  });
});
