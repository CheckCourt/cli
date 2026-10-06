import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { listen, relayUrl } from "../src/dev/listen.js";

let servers: { close: () => void }[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
  vi.restoreAllMocks();
});

async function localApp(): Promise<string> {
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => server.close() });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("relayUrl", () => {
  it("uses wss for https and appends the app", () => {
    expect(relayUrl("https://app.checkcourt.de", "demo-app")).toBe("wss://app.checkcourt.de/api/dev-relay?app=demo-app");
    expect(relayUrl("http://localhost:8080", "a b")).toBe("ws://localhost:8080/api/dev-relay?app=a+b");
  });
});

describe("listen", () => {
  it("reconnects after a drop, forwards, and stops on a fatal close", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    servers.push({ close: () => wss.close() });
    await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
    const host = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const forwardTo = await localApp();

    let connections = 0;
    const responses: unknown[] = [];
    const auth: (string | undefined)[] = [];
    wss.on("connection", (ws, req) => {
      connections++;
      auth.push(req.headers.authorization);
      if (connections === 1) return ws.close(1011);
      if (connections === 2) {
        ws.send(JSON.stringify({ type: "ready", session_id: "drs_1", app: { id: "a", slug: "demo-app", name: "Demo" }, sandbox: { tenant_id: "t", name: "Sandbox" }, installations: 1 }));
        ws.send(JSON.stringify({ type: "request", id: "r1", kind: "webhook", method: "POST", path: "/hook", headers: {}, body: "{}", meta: { eventType: "booking.created" }, timeoutMs: 5000 }));
        ws.on("message", (data) => {
          responses.push(JSON.parse(data.toString()));
          ws.close(1011);
        });
        return;
      }
      ws.close(4003);
    });

    const lines: string[] = [];
    const code = await listen({ host, token: "ccd_x", app: "demo-app", forwardTo, log: (l) => lines.push(l) });

    expect(code).toBe(1);
    expect(connections).toBe(3);
    expect(auth).toEqual(["Bearer ccd_x", "Bearer ccd_x", "Bearer ccd_x"]);
    expect(responses).toEqual([{ type: "response", id: "r1", status: 200, body: "ok", duration_ms: expect.any(Number) }]);
    expect(lines.some((l) => l.includes("neuer Versuch"))).toBe(true);
    expect(lines.some((l) => l.includes("booking.created") && l.includes("-> 200"))).toBe(true);
    expect(lines.at(-1)).toContain("CLI-Sitzung wurde beendet");
  });
});
