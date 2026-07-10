import { Pool } from "pg";

declare global {
  var __macvendorPool: Pool | undefined;
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  globalThis.__macvendorPool ??= createPool(connectionString);
  return globalThis.__macvendorPool;
}
