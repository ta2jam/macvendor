import path from "node:path";
import { config } from "dotenv";

export function loadLocalEnvironment(
  environment: Record<string, string | undefined> = process.env,
  directory: string = process.cwd(),
): Record<string, string | undefined> {
  config({
    path: path.join(directory, ".env.local"),
    processEnv: environment,
    quiet: true,
  });
  return environment;
}
