import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { forwardRequest, targetUrl, type RelayRequest } from "../src/dev/forward.js";

let server: Server;
let base: string;
const seen: { url: string; headers: IncomingHttpHeaders; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      if (req.url?.startsWith("/slow")) return void setTimeout(() => res.end("late"), 1000);
      res.writeHead(req.url?.startsWith("/fail") ? 500 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function request(overrides: Partial<RelayRequest> = {}): RelayRequest {
  return {
    id: "r1",
    kind: "webhook",
    method: "POST",
    path: "/api/checkcourt/webhooks",
    headers: { "Content-Type": "application/json", "CheckCourt-Signature": "t=1,v1=abc", "Content-Length": "999" },
    body: '{"id":"evt_1"}',
    meta: { eventType: "booking.created" },
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("targetUrl", () => {
  it("keeps the path of the production URL unless overridden", () => {
    expect(targetUrl(request(), { forwardTo: "http://localhost:4000" })).toBe(
      "http://localhost:4000/api/checkcourt/webhooks",
    );
    expect(targetUrl(request(), { forwardTo: "http://localhost:4000", webhookPath: "/hooks" })).toBe(
      "http://localhost:4000/hooks",
    );
    const ext = request({ kind: "extension_render", path: "/ext/widget?v=1" });
    expect(targetUrl(ext, { forwardTo: "http://localhost:4000", webhookPath: "/hooks" })).toBe(
      "http://localhost:4000/ext/widget?v=1",
    );
    expect(targetUrl(ext, { forwardTo: "http://localhost:4000", extensionPath: "/x" })).toBe("http://localhost:4000/x");
  });
});

describe("forwardRequest", () => {
  it("forwards body and signature headers unchanged and returns the response", async () => {
    seen.length = 0;
    const result = await forwardRequest(request(), { forwardTo: base });
    expect(result).toMatchObject({ id: "r1", status: 200, body: '{"ok":true}' });
    expect(seen[0]).toMatchObject({ url: "/api/checkcourt/webhooks", body: '{"id":"evt_1"}' });
    expect(seen[0].headers["checkcourt-signature"]).toBe("t=1,v1=abc");
    expect(seen[0].headers["content-length"]).toBe(String('{"id":"evt_1"}'.length));
  });

  it("returns error statuses of the app", async () => {
    const result = await forwardRequest(request({ path: "/fail" }), { forwardTo: base });
    expect(result).toMatchObject({ status: 500 });
  });

  it("reports an app that is not running and timeouts as errors", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const refused = await forwardRequest(request(), { forwardTo: `http://127.0.0.1:${port}` });
    expect(refused).toMatchObject({ error: "ECONNREFUSED" });
    const slow = await forwardRequest(request({ path: "/slow", timeoutMs: 600 }), { forwardTo: base });
    expect(slow).toMatchObject({ error: "Zeitüberschreitung" });
  });
});
