import { describe, expect, it } from "vitest";
import { backoffDelay } from "../src/dev/backoff.js";
import { formatLogLine } from "../src/dev/format.js";
import { formatDelivery } from "../src/dev/commands.js";

describe("backoffDelay", () => {
  it("doubles up to the cap and jitters within the upper half", () => {
    const at = (attempt: number, random: number) => backoffDelay(attempt, { baseMs: 1000, maxMs: 30_000, random: () => random });
    expect([0, 1, 2, 3].map((a) => at(a, 1))).toEqual([1000, 2000, 4000, 8000]);
    expect(at(10, 1)).toBe(30_000);
    expect(at(10, 0)).toBe(15_000);
    expect(at(0, 0)).toBe(500);
  });
});

describe("formatLogLine", () => {
  const at = new Date(2026, 9, 6, 9, 5, 7);
  it("shows time, kind, event, local status and duration", () => {
    expect(formatLogLine({ at, kind: "webhook", label: "booking.created", status: 200, durationMs: 34 })).toBe(
      "09:05:07  webhook    booking.created         -> 200  34 ms",
    );
  });
  it("shows errors and extension points", () => {
    const line = formatLogLine({ at, kind: "extension_render", label: "dashboard.widget", error: "ECONNREFUSED", durationMs: 2 });
    expect(line).toContain("extension");
    expect(line).toContain("dashboard.widget");
    expect(line).toContain("fehler ECONNREFUSED");
  });
  it("only colours when asked to", () => {
    const plain = formatLogLine({ at, kind: "webhook", label: "x", status: 500, durationMs: 1 });
    expect(plain).not.toContain("\x1b[");
    expect(formatLogLine({ at, kind: "webhook", label: "x", status: 500, durationMs: 1 }, { color: true })).toContain("\x1b[31m500");
  });
});

describe("formatDelivery", () => {
  it("names event, status, attempts and route", () => {
    const line = formatDelivery({
      id: "whd_1",
      event_type: "booking.created",
      status: "succeeded",
      attempts: 1,
      last_attempt_at: "2026-10-06T07:05:07.000Z",
      last_response_status: 200,
      last_error: null,
      via: "cli",
      created_at: "2026-10-06T07:05:00.000Z",
    });
    expect(line).toMatch(/booking\.created\s+zugestellt\s+1x {2}über CLI {2}HTTP 200$/);
  });
});
