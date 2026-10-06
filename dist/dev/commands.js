import { devFetch } from "./api.js";
export async function listTriggers(host, token) {
    return (await devFetch(host, "/api/cli/trigger", { token })).events;
}
export async function trigger(host, token, app, event) {
    return devFetch(host, "/api/cli/trigger", { token, body: { app, event } });
}
export async function deliveries(host, token, app, limit = 20) {
    const params = new URLSearchParams({ app, limit: String(limit) });
    return (await devFetch(host, `/api/cli/logs?${params}`, { token })).deliveries;
}
const STATUS_LABELS = {
    pending: "offen",
    succeeded: "zugestellt",
    failed: "fehlgeschlagen",
};
export function formatDelivery(d) {
    const at = new Date(d.last_attempt_at ?? d.created_at);
    const time = at.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
    const result = d.last_response_status !== null ? `HTTP ${d.last_response_status}` : (d.last_error ?? "");
    const via = d.via === "cli" ? "über CLI" : "direkt";
    return [time, d.event_type.padEnd(22), STATUS_LABELS[d.status].padEnd(14), `${d.attempts}x`, via, result]
        .filter(Boolean)
        .join("  ");
}
