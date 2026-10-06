import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
  tenantId?: string;
  tenantName?: string;
  /** `checkcourt login` (developer relay); separate from the personal API key. */
  cliToken?: string;
  cliTokenExpiresAt?: string;
  cliHost?: string;
}

const CONFIG_PATH = join(homedir(), ".checkcourt.json");

export function loadConfig(): CliConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

// Env vars override the config file, so scripts and CI stay configurable
// without touching the interactive app's stored login.
export function resolveConfig(): CliConfig {
  const file = loadConfig();
  return {
    apiKey: process.env.CHECKCOURT_API_KEY ?? file.apiKey,
    baseUrl:
      process.env.CHECKCOURT_BASE_URL ??
      file.baseUrl ??
      "https://app.checkcourt.de/api/v1",
    tenantId: process.env.CHECKCOURT_TENANT_ID ?? file.tenantId,
    tenantName: file.tenantName,
  };
}

/** Origin of the platform for developer commands: CHECKCOURT_HOST, the login's host, or the API base URL's origin. */
export function resolveHost(override?: string): string {
  const file = loadConfig();
  const raw =
    override ??
    process.env.CHECKCOURT_HOST ??
    file.cliHost ??
    process.env.CHECKCOURT_BASE_URL ??
    file.baseUrl ??
    "https://app.checkcourt.de";
  return new URL(raw).origin;
}
