import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { loadConfig, saveConfig } from "../config.js";
import { DevApiError, devFetch } from "./api.js";

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The URL is printed anyway.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** RFC 8628 device flow: show the code, open the browser, poll until approved, store the token. */
export async function login(host: string, options: { browser: boolean; log: (line: string) => void }): Promise<void> {
  const code = await devFetch<DeviceCode>(host, "/api/cli/device/code", {
    body: { client_name: `checkcourt auf ${hostname()}` },
  });
  options.log(`Bestätige diesen Code im Browser: ${code.user_code}`);
  options.log(`  ${code.verification_uri_complete}`);
  if (options.browser) openBrowser(code.verification_uri_complete);

  let interval = code.interval;
  const deadline = Date.now() + code.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    try {
      const token = await devFetch<TokenResponse>(host, "/api/cli/device/token", {
        body: { grant_type: DEVICE_GRANT, device_code: code.device_code },
      });
      saveConfig({
        ...loadConfig(),
        cliToken: token.access_token,
        cliTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        cliHost: host,
      });
      return;
    } catch (err) {
      if (!(err instanceof DevApiError)) throw err;
      if (err.code === "authorization_pending") continue;
      if (err.code === "slow_down") {
        interval += 5;
        continue;
      }
      throw err;
    }
  }
  throw new DevApiError(400, "expired_token", "Der Code ist abgelaufen. Starte checkcourt login neu.");
}

export async function logout(host: string, token: string | undefined): Promise<void> {
  if (token) {
    await devFetch(host, "/api/cli/session", { method: "DELETE", token }).catch(() => {});
  }
  const { cliToken: _t, cliTokenExpiresAt: _e, cliHost: _h, ...rest } = loadConfig();
  saveConfig(rest);
}
