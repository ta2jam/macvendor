const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertTestDatabaseUrl(value: string, allowRemote = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use postgres or postgresql");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!database.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL must point to a database whose name ends with _test");
  }
  if (!allowRemote && !LOCAL_DATABASE_HOSTS.has(url.hostname)) {
    throw new Error("remote test databases require TEST_DATABASE_ALLOW_REMOTE=true");
  }
  return url;
}
