import { loadConfig } from "../config.js";
export class DevApiError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "DevApiError";
    }
}
/** The stored login, or null; CHECKCOURT_CLI_TOKEN wins for CI. */
export function storedSession(host) {
    const file = loadConfig();
    const token = process.env.CHECKCOURT_CLI_TOKEN ?? file.cliToken;
    if (!token)
        return null;
    return { host: file.cliHost && !process.env.CHECKCOURT_HOST ? file.cliHost : host, token };
}
export async function devFetch(host, path, init = {}) {
    const res = await fetch(new URL(path, host), {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json().catch(() => ({})));
    if (!res.ok) {
        throw new DevApiError(res.status, typeof data.error === "string" ? data.error : "error", typeof data.error_description === "string" ? data.error_description : `HTTP ${res.status}`);
    }
    return data;
}
