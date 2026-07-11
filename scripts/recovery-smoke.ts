import "./env";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogicalBackup } from "../src/recovery/backup";
import {
  createDisposableDatabase, databaseName, dropDisposableDatabase, RecoveryError,
} from "../src/recovery/database";
import { rebuildFromSyntheticArtifacts } from "../src/recovery/rebuild";
import { restoreLogicalBackup } from "../src/recovery/restore";

const sourceUrl = process.env.RECOVERY_SOURCE_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.RECOVERY_ADMIN_DATABASE_URL;
if (!sourceUrl) throw new Error("RECOVERY_SOURCE_DATABASE_URL or TEST_DATABASE_URL is required");
if (!adminDatabaseUrl) throw new Error("RECOVERY_ADMIN_DATABASE_URL is required");
const sourceName = databaseName(sourceUrl);
if (["postgres", "template0", "template1"].includes(sourceName)) {
  throw new Error("recovery smoke source cannot be a maintenance database");
}
const suffix = randomBytes(3).toString("hex");
const safeBase = sourceName.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "macvendor";
const restoreTarget = `${safeBase}_restore_${suffix}`;
const rebuildTarget = `${safeBase}_rebuild_${suffix}`;
const collisionTarget = `${safeBase}_restore_${randomBytes(3).toString("hex")}`;
const directory = await mkdtemp(path.join(tmpdir(), "macvendor-recovery-smoke-"));
await chmod(directory, 0o700);
try {
  const backup = await createLogicalBackup(sourceUrl, directory);
  await createDisposableDatabase(adminDatabaseUrl, collisionTarget, "restore");
  let collisionGuardPassed = false;
  try {
    await restoreLogicalBackup({
      adminDatabaseUrl, manifestPath: backup.manifestPath,
      targetDatabase: collisionTarget, dropAfterCheck: true,
    });
  } catch (error) {
    if (error instanceof RecoveryError && error.code === "TARGET_DATABASE_EXISTS") collisionGuardPassed = true;
    else throw error;
  } finally {
    await dropDisposableDatabase(adminDatabaseUrl, collisionTarget, "restore");
  }
  if (!collisionGuardPassed) throw new Error("recovery collision guard did not reject the pre-existing database");
  const restored = await restoreLogicalBackup({
    adminDatabaseUrl, manifestPath: backup.manifestPath,
    targetDatabase: restoreTarget, dropAfterCheck: true,
  });
  const rebuilt = await rebuildFromSyntheticArtifacts({
    adminDatabaseUrl, targetDatabase: rebuildTarget, dropAfterCheck: true,
  });
  console.log(JSON.stringify({
    status: "verified",
    preExistingTargetGuard: collisionGuardPassed,
    backup: { byteSize: backup.byteSize, sha256: backup.sha256, durationMs: backup.durationMs },
    restore: { durationMs: restored.durationMs, dropped: restored.dropped },
    rebuild: { durationMs: rebuilt.durationMs, dropped: rebuilt.dropped, outputHash: rebuilt.outputHash },
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
