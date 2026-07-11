import { cp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

try {
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
    force: true,
  });
  await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
    recursive: true,
    force: true,
  });
} catch (error) {
  console.error("Standalone assets are unavailable. Run npm run build before npm start.");
  throw error;
}

await import(pathToFileURL(path.join(standalone, "server.js")).href);
