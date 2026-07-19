import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("production operations scripts", () => {
  it("keeps current and previous macvendor image tags without touching another site", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "macvendor-retention-"));
    const root = path.join(directory, "site");
    const bin = path.join(directory, "bin");
    const log = path.join(directory, "docker.log");
    await mkdir(path.join(root, "releases", "v0.5.8", "app"), { recursive: true });
    await mkdir(path.join(root, "releases", "v0.6.0", "app"), { recursive: true });
    await mkdir(bin);
    await symlink(path.join(root, "releases", "v0.6.0", "app"), path.join(root, "app"));
    await writeFile(path.join(bin, "find"), "#!/bin/sh\nprintf 'v0.5.8\\nv0.6.0\\n'\n", { mode: 0o755 });
    await writeFile(path.join(bin, "docker"), `#!/bin/sh
if [ "$1 $2" = "image ls" ]; then
  printf 'macvendor-app latest\\nmacvendor-app v0.6.0\\nmacvendor-app v0.5.8\\nmacvendor-app v0.5.7\\nmacvendor-tooling current\\nmacvendor-tooling v0.6.0\\nmacvendor-tooling v0.5.8\\nmacvendor-tooling v0.5.7\\nmibvendor 0.1.0\\n'
else
  printf '%s\\n' "$*" >> "$DOCKER_LOG"
fi
`, { mode: 0o755 });
    try {
      await execFileAsync("sh", ["deploy/macvendor-image-retention"], {
        cwd: process.cwd(),
        env: { ...process.env, MACVENDOR_ROOT: root, DOCKER_LOG: log, PATH: `${bin}:${process.env.PATH}` },
      });
      const actions = await readFile(log, "utf8");
      expect(actions).toContain("image rm macvendor-app:v0.5.7");
      expect(actions).toContain("image rm macvendor-tooling:v0.5.7");
      expect(actions).not.toContain("v0.5.8");
      expect(actions).not.toContain("v0.6.0");
      expect(actions).not.toContain("mibvendor");
      expect(actions).toContain("builder prune --force --filter until=168h");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("derives release identity from Git and contains a rollback trap", async () => {
    const script = await readFile("scripts/deploy-production.sh", "utf8");
    expect(script).toContain("sha=$(git rev-parse HEAD)");
    expect(script).toContain("trap rollback EXIT HUP INT TERM");
    expect(script).not.toMatch(/RELEASE_SHA=[0-9a-f]{40}/);
  });

  it("gives the hardened retention unit an isolated writable Docker config", async () => {
    const unit = await readFile("deploy/macvendor-image-retention.service", "utf8");
    expect(unit).toContain("Environment=DOCKER_CONFIG=/run/macvendor-image-retention/docker");
    expect(unit).toContain("RuntimeDirectory=macvendor-image-retention");
    expect(unit).toContain("RuntimeDirectoryMode=0700");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("ProtectSystem=full");
  });
});
