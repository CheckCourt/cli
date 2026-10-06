import { devFetch } from "./api.js";

export interface TriggerableEvent {
  type: string;
  description: string;
}

export async function listTriggers(host: string, token: string): Promise<TriggerableEvent[]> {
  return (await devFetch<{ events: TriggerableEvent[] }>(host, "/api/cli/trigger", { token })).events;
}

export async function trigger(
  host: string,
  token: string,
  app: string,
  event: string,
): Promise<{ event: string; object: { type: string; id: string } }> {
  return devFetch(host, "/api/cli/trigger", { token, body: { app, event } });
}

export interface DeliveryLog {
  id: string;
  event_type: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
  via: "cli" | null;
  created_at: string;
}

export async function deliveries(host: string, token: string, app: string, limit = 20): Promise<DeliveryLog[]> {
  const params = new URLSearchParams({ app, limit: String(limit) });
  return (await devFetch<{ deliveries: DeliveryLog[] }>(host, `/api/cli/logs?${params}`, { token })).deliveries;
}

const STATUS_LABELS: Record<DeliveryLog["status"], string> = {
  pending: "offen",
  succeeded: "zugestellt",
  failed: "fehlgeschlagen",
};

export function formatDelivery(d: DeliveryLog): string {
  const at = new Date(d.last_attempt_at ?? d.created_at);
  const time = at.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
  const result = d.last_response_status !== null ? `HTTP ${d.last_response_status}` : (d.last_error ?? "");
  const via = d.via === "cli" ? "über CLI" : "direkt";
  return [time, d.event_type.padEnd(22), STATUS_LABELS[d.status].padEnd(14), `${d.attempts}x`, via, result]
    .filter(Boolean)
    .join("  ");
}
