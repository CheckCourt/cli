import { loadConfig } from "../config.js";

export class DevApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DevApiError";
  }
}

export interface DevSession {
  host: string;
  token: string;
}

/** The stored login, or null; CHECKCOURT_CLI_TOKEN wins for CI. */
export function storedSession(host: string): DevSession | null {
  const file = loadConfig();
  const token = process.env.CHECKCOURT_CLI_TOKEN ?? file.cliToken;
  if (!token) return null;
  return { host: file.cliHost && !process.env.CHECKCOURT_HOST ? file.cliHost : host, token };
}

export async function devFetch<T>(
  host: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(new URL(path, host), {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DevApiError(
      res.status,
      typeof data.error === "string" ? data.error : "error",
      typeof data.error_description === "string" ? data.error_description : `HTTP ${res.status}`,
    );
  }
  return data as T;
}
