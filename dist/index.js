#!/usr/bin/env node

// src/index.ts
import { render } from "ink";
import { createElement } from "react";

// node_modules/@checkcourt/sdk/dist/client.js
import createClient, {} from "openapi-fetch";

// node_modules/@checkcourt/sdk/dist/internal/base-url.js
var DEFAULT_BASE_URL = "https://app.checkcourt.de";
function normalizeBaseUrl(baseUrl) {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

// node_modules/@checkcourt/sdk/dist/client.js
var TENANT_HEADER = "X-Tenant-Id";
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function retryAfterMs(value, now = Date.now()) {
  if (!value)
    return null;
  if (/^\d+$/.test(value.trim()))
    return Number(value.trim()) * 1e3;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
function discard(response) {
  try {
    response.body?.cancel().catch(() => {
    });
  } catch {
  }
}
function createCheckCourtClient(options) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const doFetch = options.fetch ?? ((request) => fetch(request));
  const retry = options.retry === false ? null : options.retry ?? {};
  const maxRetries = retry?.maxRetries ?? 2;
  const baseDelay = retry?.baseDelayMs ?? 1e3;
  const maxDelay = retry?.maxDelayMs ?? 6e4;
  const context = { baseUrl, fetch: doFetch };
  const authedFetch = async (request) => {
    let retries = 0;
    let reauthenticated = false;
    for (; ; ) {
      const attempt = request.clone();
      const token = await options.auth.getAccessToken(context);
      attempt.headers.set("Authorization", `Bearer ${token}`);
      if (options.tenantId && !attempt.headers.has(TENANT_HEADER))
        attempt.headers.set(TENANT_HEADER, options.tenantId);
      const response = await doFetch(attempt);
      if (response.status === 401 && !reauthenticated && options.auth.invalidate?.(token)) {
        reauthenticated = true;
        discard(response);
        continue;
      }
      if (response.status === 429 && retry && retries < maxRetries) {
        const delay = retryAfterMs(response.headers.get("Retry-After")) ?? baseDelay * 2 ** retries;
        if (delay <= maxDelay) {
          retries += 1;
          discard(response);
          await sleep(delay);
          continue;
        }
      }
      return response;
    }
  };
  return createClient({ baseUrl: `${baseUrl}/api/v1`, fetch: authedFetch, headers: options.headers });
}

// node_modules/@checkcourt/sdk/dist/auth.js
function apiKeyAuth(apiKey) {
  return { getAccessToken: async () => apiKey };
}

// src/client.ts
function createCheckCourtClient2(config) {
  return createCheckCourtClient({
    baseUrl: config.baseUrl,
    auth: apiKeyAuth(config.apiKey),
    tenantId: config.tenantId,
    // The interactive CLI reports a 429 at once instead of stalling the screen.
    retry: false
  });
}

// src/config.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var CONFIG_PATH = join(homedir(), ".checkcourt.json");
function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    mode: 384
  });
}
function resolveConfig() {
  const file = loadConfig();
  return {
    apiKey: process.env.CHECKCOURT_API_KEY ?? file.apiKey,
    baseUrl: process.env.CHECKCOURT_BASE_URL ?? file.baseUrl ?? "https://app.checkcourt.de/api/v1",
    tenantId: process.env.CHECKCOURT_TENANT_ID ?? file.tenantId,
    tenantName: file.tenantName
  };
}
function resolveHost(override) {
  const file = loadConfig();
  const raw = override ?? process.env.CHECKCOURT_HOST ?? file.cliHost ?? process.env.CHECKCOURT_BASE_URL ?? file.baseUrl ?? "https://app.checkcourt.de";
  return new URL(raw).origin;
}

// src/dev/api.ts
var DevApiError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "DevApiError";
  }
  status;
  code;
};
function storedSession(host) {
  const file = loadConfig();
  const token = process.env.CHECKCOURT_CLI_TOKEN ?? file.cliToken;
  if (!token) return null;
  return { host: file.cliHost && !process.env.CHECKCOURT_HOST ? file.cliHost : host, token };
}
async function devFetch(host, path, init = {}) {
  const res = await fetch(new URL(path, host), {
    method: init.method ?? (init.body === void 0 ? "GET" : "POST"),
    headers: {
      ...init.body === void 0 ? {} : { "Content-Type": "application/json" },
      ...init.token ? { Authorization: `Bearer ${init.token}` } : {}
    },
    body: init.body === void 0 ? void 0 : JSON.stringify(init.body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new DevApiError(
      res.status,
      typeof data.error === "string" ? data.error : "error",
      typeof data.error_description === "string" ? data.error_description : `HTTP ${res.status}`
    );
  }
  return data;
}

// src/dev/commands.ts
async function listTriggers(host, token) {
  return (await devFetch(host, "/api/cli/trigger", { token })).events;
}
async function trigger(host, token, app, event) {
  return devFetch(host, "/api/cli/trigger", { token, body: { app, event } });
}
async function deliveries(host, token, app, limit = 20) {
  const params = new URLSearchParams({ app, limit: String(limit) });
  return (await devFetch(host, `/api/cli/logs?${params}`, { token })).deliveries;
}
var STATUS_LABELS = {
  pending: "offen",
  succeeded: "zugestellt",
  failed: "fehlgeschlagen"
};
function formatDelivery(d) {
  const at = new Date(d.last_attempt_at ?? d.created_at);
  const time = at.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" });
  const result = d.last_response_status !== null ? `HTTP ${d.last_response_status}` : d.last_error ?? "";
  const via = d.via === "cli" ? "\xFCber CLI" : "direkt";
  return [time, d.event_type.padEnd(22), STATUS_LABELS[d.status].padEnd(14), `${d.attempts}x`, via, result].filter(Boolean).join("  ");
}

// src/dev/listen.ts
import WebSocket from "ws";

// src/dev/backoff.ts
function backoffDelay(attempt, options = {}) {
  const base = options.baseMs ?? 1e3;
  const max = options.maxMs ?? 3e4;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(ceiling / 2 + ceiling / 2 * random());
}

// src/dev/format.ts
var KIND_LABELS = {
  webhook: "webhook",
  extension_render: "extension",
  extension_action: "action"
};
var DIM = "\x1B[2m";
var GREEN = "\x1B[32m";
var YELLOW = "\x1B[33m";
var RED = "\x1B[31m";
var RESET = "\x1B[0m";
function paint(color, code, text) {
  return color ? `${code}${text}${RESET}` : text;
}
function clock(at) {
  return [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
function formatLogLine(input, options = {}) {
  const color = options.color ?? false;
  const result = input.error ? paint(color, RED, `fehler ${input.error}`) : paint(color, input.status < 300 ? GREEN : input.status < 500 ? YELLOW : RED, String(input.status));
  const parts = [
    paint(color, DIM, clock(input.at)),
    KIND_LABELS[input.kind].padEnd(9),
    input.label.padEnd(22),
    `-> ${result}`,
    paint(color, DIM, `${input.durationMs} ms`)
  ];
  if (input.target) parts.push(paint(color, DIM, input.target));
  return parts.join("  ");
}

// src/dev/forward.ts
var MAX_BODY = 256 * 1024;
var HOP_HEADERS = /* @__PURE__ */ new Set(["host", "content-length", "connection", "transfer-encoding"]);
function targetUrl(request, options) {
  const override = request.kind === "webhook" ? options.webhookPath : options.extensionPath;
  const path = override ?? request.path ?? "/";
  return new URL(path.startsWith("/") ? path : `/${path}`, options.forwardTo).toString();
}
async function forwardRequest(request, options) {
  const doFetch = options.fetch ?? fetch;
  const url = targetUrl(request, options);
  const headers = {};
  for (const [k, v] of Object.entries(request.headers)) {
    if (!HOP_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(200, request.timeoutMs - 300));
  try {
    const res = await doFetch(url, { method: request.method, headers, body: request.body, signal: controller.signal });
    const body = (await res.text()).slice(0, MAX_BODY);
    return { id: request.id, status: res.status, body, durationMs: Date.now() - started, url };
  } catch (err) {
    const cause = err.cause?.code;
    const message = controller.signal.aborted ? "Zeit\xFCberschreitung" : cause ?? (err instanceof Error ? err.message : String(err));
    return { id: request.id, error: message, durationMs: Date.now() - started, url };
  } finally {
    clearTimeout(timer);
  }
}

// src/dev/listen.ts
var FATAL_CLOSE = {
  4001: "Nicht angemeldet oder Anmeldung abgelaufen. Melde dich mit checkcourt login an.",
  4003: "Die CLI-Sitzung wurde beendet (widerrufen oder Organisation verlassen).",
  4004: "App nicht gefunden. Gib den Slug oder die ID einer App deiner Organisation an.",
  4009: "Die Organisation hat noch keinen Sandbox-Verein."
};
function relayUrl(host, app) {
  const url = new URL("/api/dev-relay", host);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("app", app);
  return url.toString();
}
function listen(options) {
  return new Promise((resolve) => {
    let attempt = 0;
    let stopping = false;
    let socket = null;
    let retry = null;
    const finish = (code) => {
      stopping = true;
      if (retry) clearTimeout(retry);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve(code);
    };
    function stop() {
      socket?.close(1e3);
      options.log("Weiterleitung beendet.");
      finish(0);
    }
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const connect = () => {
      const ws = new WebSocket(relayUrl(options.host, options.app), {
        headers: { Authorization: `Bearer ${options.token}` }
      });
      socket = ws;
      ws.on("message", async (data) => {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message.type === "ready") {
          attempt = 0;
          options.log(
            `Bereit. ${message.app.name} (${message.app.slug}) im Sandbox-Verein ${message.sandbox.name} wird an ${options.forwardTo} weitergeleitet. Beenden mit Ctrl+C.`
          );
          if (message.installations === 0) {
            options.log("Hinweis: Die App ist im Sandbox-Verein nicht installiert, es kommt also nichts an.");
          }
          return;
        }
        if (message.type !== "request") return;
        const result = await forwardRequest(message, options);
        options.log(
          formatLogLine(
            {
              at: /* @__PURE__ */ new Date(),
              kind: message.kind,
              label: message.meta.eventType ?? message.meta.point ?? message.path,
              ..."error" in result ? { error: result.error } : { status: result.status },
              durationMs: result.durationMs,
              target: result.url
            },
            { color: options.color }
          )
        );
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify(
            "error" in result ? { type: "response", id: result.id, error: result.error } : { type: "response", id: result.id, status: result.status, body: result.body, duration_ms: result.durationMs }
          )
        );
      });
      ws.on("error", () => {
      });
      ws.on("close", (code) => {
        if (stopping) return;
        const fatal = FATAL_CLOSE[code];
        if (fatal) {
          options.log(fatal);
          finish(1);
          return;
        }
        const delay = backoffDelay(attempt++);
        options.log(`Verbindung getrennt, neuer Versuch in ${Math.round(delay / 1e3)} s ...`);
        retry = setTimeout(connect, delay);
      });
    };
    connect();
  });
}

// src/dev/login.ts
import { spawn } from "node:child_process";
import { hostname } from "node:os";
var DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
function openBrowser(url) {
  const command2 = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(command2, args, { stdio: "ignore", detached: true }).on("error", () => {
    }).unref();
  } catch {
  }
}
var sleep2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function login(host, options) {
  const code = await devFetch(host, "/api/cli/device/code", {
    body: { client_name: `checkcourt auf ${hostname()}` }
  });
  options.log(`Best\xE4tige diesen Code im Browser: ${code.user_code}`);
  options.log(`  ${code.verification_uri_complete}`);
  if (options.browser) openBrowser(code.verification_uri_complete);
  let interval = code.interval;
  const deadline = Date.now() + code.expires_in * 1e3;
  while (Date.now() < deadline) {
    await sleep2(interval * 1e3);
    try {
      const token = await devFetch(host, "/api/cli/device/token", {
        body: { grant_type: DEVICE_GRANT, device_code: code.device_code }
      });
      saveConfig({
        ...loadConfig(),
        cliToken: token.access_token,
        cliTokenExpiresAt: new Date(Date.now() + token.expires_in * 1e3).toISOString(),
        cliHost: host
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
async function logout(host, token) {
  if (token) {
    await devFetch(host, "/api/cli/session", { method: "DELETE", token }).catch(() => {
    });
  }
  const { cliToken: _t, cliTokenExpiresAt: _e, cliHost: _h, ...rest2 } = loadConfig();
  saveConfig(rest2);
}

// src/dev/main.ts
var RED2 = "\x1B[31m";
var GREEN2 = "\x1B[32m";
var DIM2 = "\x1B[2m";
var RESET2 = "\x1B[0m";
function parse(args) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    else if (args[i + 1] !== void 0 && !args[i + 1].startsWith("--")) flags.set(arg.slice(2), args[++i]);
    else flags.set(arg.slice(2), true);
  }
  return { flags, positional };
}
function str(flags, name) {
  const v = flags.get(name);
  return typeof v === "string" ? v : void 0;
}
var log = (line) => console.log(line);
var fail = (message) => {
  console.error(`${RED2}Fehler:${RESET2} ${message}`);
  return 1;
};
async function runDevCommand(command2, args) {
  const { flags, positional } = parse(args);
  const host = resolveHost(str(flags, "host"));
  try {
    if (command2 === "login") {
      await login(host, { browser: !flags.has("no-browser"), log });
      log(`${GREEN2}Angemeldet.${RESET2} ${DIM2}Sitzungen verwaltest du im Entwicklerportal unter Organisation.${RESET2}`);
      return 0;
    }
    const session = storedSession(host);
    if (command2 === "logout") {
      await logout(session?.host ?? host, session?.token);
      log("Abgemeldet.");
      return 0;
    }
    if (!session) return fail("Nicht angemeldet. Zuerst: checkcourt login");
    if (command2 === "trigger" && flags.has("list")) {
      for (const e of await listTriggers(session.host, session.token)) log(`  ${e.type.padEnd(22)} ${DIM2}${e.description}${RESET2}`);
      return 0;
    }
    const app = str(flags, "app");
    if (!app) return fail(`${command2} braucht --app <slug>`);
    if (command2 === "listen") {
      const forwardTo = str(flags, "forward-to");
      if (!forwardTo) return fail("listen braucht --forward-to, z. B. http://localhost:4000");
      return await listen({
        host: session.host,
        token: session.token,
        app,
        forwardTo,
        webhookPath: str(flags, "webhook-path"),
        extensionPath: str(flags, "extension-path"),
        log,
        color: process.stdout.isTTY
      });
    }
    if (command2 === "trigger") {
      const event = positional[0];
      if (!event) return fail("trigger braucht ein Ereignis, z. B. booking.created (Liste: checkcourt trigger --list)");
      const result = await trigger(session.host, session.token, app, event);
      log(`${GREEN2}Ausgel\xF6st:${RESET2} ${result.event} ${DIM2}(${result.object.type} ${result.object.id})${RESET2}`);
      return 0;
    }
    if (command2 === "logs") {
      const seen = /* @__PURE__ */ new Set();
      const print = async () => {
        const rows = await deliveries(session.host, session.token, app);
        for (const d of rows.reverse()) {
          const key = `${d.id}:${d.status}:${d.attempts}`;
          if (seen.has(key)) continue;
          seen.add(key);
          log(formatDelivery(d));
        }
      };
      await print();
      if (!flags.has("follow")) return 0;
      for (; ; ) {
        await new Promise((resolve) => setTimeout(resolve, 2e3));
        await print();
      }
    }
    return fail(`Unbekannter Befehl: ${command2}`);
  } catch (err) {
    if (err instanceof DevApiError) return fail(err.message);
    if (err instanceof Error && "cause" in err) return fail(`${host} nicht erreichbar (${err.message})`);
    throw err;
  }
}

// src/app.tsx
import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { jsx, jsxs } from "react/jsx-runtime";
function describeError(error) {
  const e = error;
  if (e?.error?.message) return `${e.error.code}: ${e.error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
function addDays(date, days) {
  const d = /* @__PURE__ */ new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function Header({ config }) {
  return /* @__PURE__ */ jsxs(
    Box,
    {
      borderStyle: "round",
      borderColor: "green",
      paddingX: 1,
      justifyContent: "space-between",
      children: [
        /* @__PURE__ */ jsxs(Text, { children: [
          /* @__PURE__ */ jsx(Text, { color: "green", bold: true, children: "\u25CF CheckCourt" }),
          config.tenantName ? /* @__PURE__ */ jsxs(Text, { children: [
            " \xB7 ",
            config.tenantName
          ] }) : null
        ] }),
        /* @__PURE__ */ jsx(Text, { dimColor: true, children: config.baseUrl })
      ]
    }
  );
}
function Footer({ hints }) {
  return /* @__PURE__ */ jsx(Box, { paddingX: 1, children: /* @__PURE__ */ jsx(Text, { dimColor: true, children: hints }) });
}
function SelectList({
  items,
  onSelect,
  onBack,
  emptyText
}) {
  const [index, setIndex] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setIndex((i) => Math.min(items.length - 1, i + 1));
    if (key.return && items[index]) onSelect(items[index].value);
    if (key.escape && onBack) onBack();
  });
  if (items.length === 0) {
    return /* @__PURE__ */ jsx(Text, { dimColor: true, children: emptyText ?? "Keine Eintr\xE4ge" });
  }
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: items.map((item, i) => /* @__PURE__ */ jsxs(Text, { color: i === index ? "green" : void 0, children: [
    i === index ? "\u276F " : "  ",
    item.label,
    item.hint ? /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
      " ",
      item.hint
    ] }) : null
  ] }, i)) });
}
function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState(() => resolveConfig());
  const [client, setClient] = useState(() => {
    const c = resolveConfig();
    return c.apiKey && c.baseUrl ? createCheckCourtClient2({
      baseUrl: c.baseUrl,
      apiKey: c.apiKey,
      tenantId: c.tenantId
    }) : null;
  });
  const [screen, setScreen] = useState(() => {
    const c = resolveConfig();
    if (!c.apiKey) return "setup-key";
    return c.tenantId ? "menu" : "tenants";
  });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const applyConfig = (next) => {
    saveConfig(next);
    setConfig(next);
    if (next.apiKey && next.baseUrl) {
      setClient(
        createCheckCourtClient2({
          baseUrl: next.baseUrl,
          apiKey: next.apiKey,
          tenantId: next.tenantId
        })
      );
    }
  };
  const [keyDraft, setKeyDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(
    config.baseUrl ?? "https://app.checkcourt.de/api/v1"
  );
  const [tenants, setTenants] = useState(null);
  useEffect(() => {
    if (screen !== "tenants" || !client) return;
    setTenants(null);
    setError(null);
    client.GET("/me/tenants").then(({ data, error: err }) => {
      if (!data) return setError(describeError(err));
      setTenants(data.tenants ?? []);
    }).catch((e) => setError(describeError(e)));
  }, [screen, client]);
  const [date, setDate] = useState(() => addDays((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), 1));
  const [courtSlots, setCourtSlots] = useState(null);
  const [selectedCourt, setSelectedCourt] = useState(null);
  const [courtIndex, setCourtIndex] = useState(0);
  const [slotIndex, setSlotIndex] = useState(0);
  const [slotQuery, setSlotQuery] = useState("");
  const [pendingSlot, setPendingSlot] = useState(null);
  useEffect(() => {
    if (screen !== "courts" && screen !== "slots" || !client) return;
    setCourtSlots(null);
    setError(null);
    client.GET("/availability/slots", { params: { query: { date, durationMinutes: 60 } } }).then(({ data, error: err }) => {
      if (!data) return setError(describeError(err));
      setCourtSlots(
        (data.courts ?? []).map((c) => ({
          courtId: c.courtId,
          courtName: c.courtName,
          slots: c.slots ?? []
        }))
      );
    }).catch((e) => setError(describeError(e)));
  }, [screen === "courts" || screen === "slots", client, date]);
  const activeCourt = courtSlots?.find((c) => c.courtId === selectedCourt?.courtId) ?? null;
  const filteredSlots = (activeCourt?.slots ?? []).filter(
    (t) => t.startsWith(slotQuery)
  );
  useInput(
    (_input, key) => {
      const courts = courtSlots ?? [];
      if (key.leftArrow) setDate((d) => addDays(d, -1));
      if (key.rightArrow) setDate((d) => addDays(d, 1));
      if (key.upArrow) setCourtIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setCourtIndex((i) => Math.min(courts.length - 1, i + 1));
      if (key.return && courts[courtIndex]) {
        setSelectedCourt(courts[courtIndex]);
        setSlotQuery("");
        setSlotIndex(0);
        setScreen("slots");
      }
      if (key.escape) setScreen("menu");
    },
    { isActive: screen === "courts" }
  );
  useInput(
    (input, key) => {
      if (key.leftArrow) {
        setDate((d) => addDays(d, -1));
        setSlotIndex(0);
        return;
      }
      if (key.rightArrow) {
        setDate((d) => addDays(d, 1));
        setSlotIndex(0);
        return;
      }
      if (key.upArrow) setSlotIndex((i) => Math.max(0, i - 1));
      if (key.downArrow)
        setSlotIndex((i) => Math.min(Math.max(filteredSlots.length - 1, 0), i + 1));
      if (key.return && activeCourt && filteredSlots[slotIndex]) {
        setPendingSlot({
          courtId: activeCourt.courtId,
          courtName: activeCourt.courtName,
          time: filteredSlots[slotIndex]
        });
        setGuestDraft("");
        setScreen("book");
        return;
      }
      if (key.backspace || key.delete) {
        setSlotQuery((q) => q.slice(0, -1));
        setSlotIndex(0);
        return;
      }
      if (key.escape) {
        if (slotQuery) {
          setSlotQuery("");
          setSlotIndex(0);
        } else {
          setScreen("courts");
        }
        return;
      }
      if (/^[0-9:]$/.test(input)) {
        setSlotQuery((q) => (q + input).slice(0, 5));
        setSlotIndex(0);
      }
    },
    { isActive: screen === "slots" }
  );
  const [guestDraft, setGuestDraft] = useState("");
  const [booking, setBooking] = useState(false);
  const submitBooking = async () => {
    const slot = pendingSlot;
    if (!slot || !client || booking) return;
    setBooking(true);
    setError(null);
    const end = `${String(Number(slot.time.slice(0, 2)) + 1).padStart(2, "0")}${slot.time.slice(2)}`;
    try {
      const { data, error: err } = await client.POST("/me/bookings", {
        body: {
          courtId: slot.courtId,
          date,
          startTime: slot.time,
          endTime: end,
          players: guestDraft.trim() ? [{ isGuest: true, guestName: guestDraft.trim() }] : []
        }
      });
      if (!data) {
        setError(describeError(err));
        setScreen("slots");
        return;
      }
      setNotice(
        `Gebucht: ${slot.courtName} am ${date}, ${slot.time}-${end.slice(0, 5)}`
      );
      setScreen("menu");
    } catch (e) {
      setError(describeError(e));
      setScreen("slots");
    } finally {
      setBooking(false);
    }
  };
  useInput(
    (_input, key) => {
      if (key.escape) setScreen("slots");
    },
    { isActive: screen === "book" }
  );
  const [bookings, setBookings] = useState(null);
  useEffect(() => {
    if (screen !== "bookings" || !client) return;
    setBookings(null);
    setError(null);
    client.GET("/me/bookings").then(({ data, error: err }) => {
      if (!data) return setError(describeError(err));
      setBookings(data.bookings ?? []);
    }).catch((e) => setError(describeError(e)));
  }, [screen, client]);
  const cancelBooking = async (id) => {
    if (!client) return;
    setError(null);
    try {
      const { data, error: err } = await client.DELETE("/bookings/{id}", {
        params: { path: { id } }
      });
      if (!data) return setError(describeError(err));
      setNotice("Buchung storniert");
      setBookings((b) => (b ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(describeError(e));
    }
  };
  let body = null;
  let hints = "\u2191\u2193 w\xE4hlen \xB7 Enter ok \xB7 Esc zur\xFCck";
  if (screen === "setup-key") {
    hints = "Enter best\xE4tigen";
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, children: "Willkommen! Pers\xF6nlichen API-Schl\xFCssel einrichten" }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Zu finden in der App unter Einstellungen \u2192 API-Schl\xFCssel" }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { children: "Schl\xFCssel: " }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: keyDraft,
            onChange: setKeyDraft,
            mask: "*",
            onSubmit: (value) => {
              if (!value.trim()) return;
              setScreen("setup-url");
            }
          }
        )
      ] })
    ] });
  } else if (screen === "setup-url") {
    hints = "Enter best\xE4tigen";
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, children: "API-Basis-URL" }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { children: "URL: " }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: urlDraft,
            onChange: setUrlDraft,
            onSubmit: (value) => {
              applyConfig({
                ...config,
                apiKey: keyDraft.trim(),
                baseUrl: value.trim() || "https://app.checkcourt.de/api/v1",
                tenantId: void 0,
                tenantName: void 0
              });
              setScreen("tenants");
            }
          }
        )
      ] })
    ] });
  } else if (screen === "tenants") {
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, children: "Verein w\xE4hlen" }),
      tenants === null && !error ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Lade Vereine\u2026" }) : /* @__PURE__ */ jsx(
        SelectList,
        {
          items: (tenants ?? []).map((t) => ({
            label: t.name,
            hint: `(${t.role})`,
            value: t
          })),
          emptyText: "Keine Vereine gefunden",
          onSelect: (t) => {
            applyConfig({ ...config, tenantId: t.id, tenantName: t.name });
            setScreen("menu");
          }
        }
      )
    ] });
  } else if (screen === "menu") {
    hints = "\u2191\u2193 w\xE4hlen \xB7 Enter ok \xB7 q beenden";
    body = /* @__PURE__ */ jsx(
      SelectList,
      {
        items: [
          { label: "Freie Slots & Buchen", value: "courts" },
          { label: "Meine Buchungen", value: "bookings" },
          { label: "Verein wechseln", value: "tenants" },
          { label: "Schl\xFCssel \xE4ndern", value: "setup-key" },
          { label: "Beenden", value: "exit" }
        ],
        onSelect: (value) => {
          setNotice(null);
          if (value === "exit") return exit();
          setScreen(value);
        }
      }
    );
  } else if (screen === "courts") {
    hints = "\u2190\u2192 Tag \xB7 \u2191\u2193 Platz \xB7 Enter w\xE4hlen \xB7 Esc zur\xFCck";
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsxs(Text, { bold: true, children: [
        "Platz w\xE4hlen ",
        /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "\xB7 ",
          date,
          " \xB7 60 Min"
        ] })
      ] }),
      courtSlots === null && !error ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Lade Pl\xE4tze\u2026" }) : /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: (courtSlots ?? []).map((c, i) => /* @__PURE__ */ jsxs(Text, { color: i === courtIndex ? "green" : void 0, children: [
        i === courtIndex ? "\u276F " : "  ",
        c.courtName,
        " ",
        /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "\xB7",
          " ",
          c.slots.length === 0 ? "keine freien Slots" : `${c.slots.length} freie Slots (${c.slots[0]}-${c.slots[c.slots.length - 1]})`
        ] })
      ] }, c.courtId)) })
    ] });
  } else if (screen === "slots") {
    hints = "Ziffern tippen = Suche \xB7 \u2190\u2192 Tag \xB7 \u2191\u2193 Slot \xB7 Enter buchen \xB7 Esc zur\xFCck";
    const windowSize = 10;
    const offset = Math.max(
      0,
      Math.min(slotIndex - Math.floor(windowSize / 2), filteredSlots.length - windowSize)
    );
    const visible = filteredSlots.slice(offset, offset + windowSize);
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsxs(Text, { bold: true, children: [
        activeCourt?.courtName ?? "Platz",
        " ",
        /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "\xB7 ",
          date,
          " \xB7 60 Min"
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Text, { children: [
        "Suche: ",
        slotQuery ? /* @__PURE__ */ jsx(Text, { color: "green", children: slotQuery }) : /* @__PURE__ */ jsx(Text, { dimColor: true, children: "tippe z.B. 18" }),
        slotQuery ? /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          " ",
          "\xB7 ",
          filteredSlots.length,
          " Treffer"
        ] }) : null
      ] }),
      courtSlots === null && !error ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Lade Slots\u2026" }) : filteredSlots.length === 0 ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: slotQuery ? "Keine Startzeit passt zur Suche" : "Keine freien Slots an diesem Tag" }) : /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
        offset > 0 ? /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "  \u2191 ",
          offset,
          " weitere"
        ] }) : null,
        visible.map((time, i) => {
          const realIndex = offset + i;
          return /* @__PURE__ */ jsxs(Text, { color: realIndex === slotIndex ? "green" : void 0, children: [
            realIndex === slotIndex ? "\u276F " : "  ",
            time,
            /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
              " ",
              "- ",
              `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`
            ] })
          ] }, time);
        }),
        offset + windowSize < filteredSlots.length ? /* @__PURE__ */ jsxs(Text, { dimColor: true, children: [
          "  \u2193 ",
          filteredSlots.length - offset - windowSize,
          " weitere"
        ] }) : null
      ] })
    ] });
  } else if (screen === "book") {
    const slot = pendingSlot;
    hints = "Enter buchen \xB7 Esc abbrechen";
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsxs(Text, { bold: true, children: [
        "Buchen: ",
        slot?.courtName,
        " am ",
        date,
        ", ",
        slot?.time,
        " (60 Min)"
      ] }),
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { children: "Gastname (leer = ohne Gast): " }),
        /* @__PURE__ */ jsx(
          TextInput,
          {
            value: guestDraft,
            onChange: setGuestDraft,
            onSubmit: () => void submitBooking()
          }
        )
      ] }),
      booking ? /* @__PURE__ */ jsx(Text, { color: "yellow", children: "Buche\u2026" }) : null
    ] });
  } else if (screen === "bookings") {
    hints = "\u2191\u2193 w\xE4hlen \xB7 Enter stornieren \xB7 Esc zur\xFCck";
    body = /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, children: "Meine Buchungen" }),
      bookings === null && !error ? /* @__PURE__ */ jsx(Text, { dimColor: true, children: "Lade Buchungen\u2026" }) : /* @__PURE__ */ jsx(
        SelectList,
        {
          items: (bookings ?? []).filter((b) => !b.cancelledAt).map((b) => ({
            label: `${b.date}  ${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}  ${b.courtName}`,
            value: b.id
          })),
          emptyText: "Keine anstehenden Buchungen",
          onSelect: (id) => void cancelBooking(id),
          onBack: () => setScreen("menu")
        }
      )
    ] });
  }
  useInput(
    (input) => {
      if (input === "q") exit();
    },
    { isActive: screen === "menu" }
  );
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", gap: 1, children: [
    /* @__PURE__ */ jsx(Header, { config }),
    /* @__PURE__ */ jsxs(Box, { paddingX: 1, flexDirection: "column", gap: 1, children: [
      notice ? /* @__PURE__ */ jsx(Text, { color: "green", children: notice }) : null,
      error ? /* @__PURE__ */ jsxs(Text, { color: "red", children: [
        "Fehler: ",
        error
      ] }) : null,
      body
    ] }),
    /* @__PURE__ */ jsx(Footer, { hints })
  ] });
}

// src/index.ts
var BOLD = "\x1B[1m";
var DIM3 = "\x1B[2m";
var GREEN3 = "\x1B[32m";
var RED3 = "\x1B[31m";
var RESET3 = "\x1B[0m";
var HELP = `${BOLD}checkcourt${RESET3} - CheckCourt API Demo-CLI (pers\xF6nlicher Schl\xFCssel)

Konfiguration \xFCber Umgebungsvariablen:
  CHECKCOURT_API_KEY    Pers\xF6nlicher API-Schl\xFCssel (ck_user_\u2026), erforderlich
  CHECKCOURT_TENANT_ID  Vereins-ID f\xFCr vereinsbezogene Befehle (siehe "tenants")
  CHECKCOURT_BASE_URL   Default: https://app.checkcourt.de/api/v1

Befehle:
  tenants                          Meine Vereine samt Rolle auflisten
  slots [--date D] [--duration M]  Buchbare Startzeiten pro Platz (Default: morgen, 60 Min)
  bookings                         Meine anstehenden Buchungen
  book --court ID --date D --start HH:MM --end HH:MM [--guest NAME] [--title T]
                                   Platz f\xFCr mich buchen
  cancel <buchungs-id>             Buchung stornieren

Entwicklung von Apps (Anmeldung per Browser, kein API-Schl\xFCssel n\xF6tig):
  login [--no-browser]             CLI f\xFCr deine Entwickler-Organisationen anmelden
  logout                           Abmelden und die CLI-Sitzung beenden
  listen --app SLUG --forward-to URL [--webhook-path P] [--extension-path P]
                                   Webhooks und Erweiterungen aus dem Sandbox-Verein
                                   an deine lokale App weiterleiten
  trigger <ereignis> --app SLUG    Testereignis im Sandbox-Verein ausl\xF6sen
  trigger --list                   Ausl\xF6sbare Ereignisse anzeigen
  logs --app SLUG [--follow]       Zustellungen an den Sandbox-Verein anzeigen
  (Host: --host oder CHECKCOURT_HOST, Default: https://app.checkcourt.de)
`;
function fail2(message) {
  console.error(`${RED3}Fehler:${RESET3} ${message}`);
  process.exit(1);
}
function parseFlags(args) {
  const flags = /* @__PURE__ */ new Map();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      flags.set(arg.slice(2), args[i + 1] ?? "");
      i++;
    }
  }
  return flags;
}
function apiError(error) {
  const e = error;
  fail2(e?.error ? `${e.error.code}: ${e.error.message}` : JSON.stringify(error));
}
function tomorrow() {
  return new Date(Date.now() + 864e5).toISOString().slice(0, 10);
}
var COMMANDS = ["tenants", "slots", "bookings", "book", "cancel"];
var DEV_COMMANDS = ["login", "logout", "listen", "trigger", "logs"];
var [command, ...rest] = process.argv.slice(2);
if (!command) {
  if (!process.stdin.isTTY) {
    fail2("Kein Terminal erkannt. F\xFCr Skripte: checkcourt help");
  }
  render(createElement(App));
} else {
  await runCommand(command, rest);
}
async function runCommand(command2, rest2) {
  if (command2 === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (DEV_COMMANDS.includes(command2)) {
    process.exit(await runDevCommand(command2, rest2));
  }
  if (!COMMANDS.includes(command2)) {
    console.log(HELP);
    fail2(`Unbekannter Befehl: ${command2}`);
  }
  const config = resolveConfig();
  const apiKey = config.apiKey;
  if (!apiKey) fail2("CHECKCOURT_API_KEY ist nicht gesetzt (oder einmal interaktiv anmelden: checkcourt)");
  const client = createCheckCourtClient2({
    baseUrl: config.baseUrl,
    apiKey,
    tenantId: config.tenantId
  });
  const flags = parseFlags(rest2);
  switch (command2) {
    case "tenants": {
      const { data, error } = await client.GET("/me/tenants");
      if (!data) apiError(error);
      console.log(`${BOLD}Meine Vereine${RESET3}`);
      for (const t of data.tenants ?? []) {
        console.log(`  ${t.name}  ${DIM3}(${(t.roles ?? []).map((r) => r.name).join(", ")})${RESET3}`);
        console.log(`    ${DIM3}id: ${t.id}${RESET3}`);
      }
      break;
    }
    case "slots": {
      const date = flags.get("date") ?? tomorrow();
      const durationMinutes = Number(flags.get("duration") ?? 60);
      const { data, error } = await client.GET("/availability/slots", {
        params: { query: { date, durationMinutes } }
      });
      if (!data) apiError(error);
      console.log(`${BOLD}Freie Slots am ${data.date}${RESET3} ${DIM3}(${data.durationMinutes} Min)${RESET3}`);
      for (const c of data.courts ?? []) {
        const slots = c.slots ?? [];
        console.log(
          `  ${c.courtName}: ${slots.length ? slots.join("  ") : `${DIM3}keine${RESET3}`}`
        );
      }
      break;
    }
    case "bookings": {
      const { data, error } = await client.GET("/me/bookings");
      if (!data) apiError(error);
      console.log(`${BOLD}Meine Buchungen${RESET3}`);
      const bookings = data.bookings ?? [];
      if (bookings.length === 0) console.log(`  ${DIM3}keine anstehenden Buchungen${RESET3}`);
      for (const b of bookings) {
        const time = `${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}`;
        const status = b.cancelledAt ? ` ${RED3}storniert${RESET3}` : "";
        console.log(`  ${b.date}  ${time}  ${b.courtName}${status}`);
        console.log(`    ${DIM3}id: ${b.id}${RESET3}`);
      }
      break;
    }
    case "book": {
      const courtId = Number(flags.get("court"));
      const date = flags.get("date");
      const startTime = flags.get("start");
      const endTime = flags.get("end");
      if (!courtId || !date || !startTime || !endTime) {
        fail2("book braucht --court, --date, --start und --end");
      }
      const guest = flags.get("guest");
      const { data, error } = await client.POST("/me/bookings", {
        body: {
          courtId,
          date,
          startTime,
          endTime,
          title: flags.get("title"),
          players: guest ? [{ isGuest: true, guestName: guest }] : []
        }
      });
      if (!data) apiError(error);
      const b = data.booking;
      console.log(
        `${GREEN3}Gebucht:${RESET3} Platz ${b?.courtId} am ${b?.date}, ${b?.startTime}-${b?.endTime}`
      );
      console.log(`  ${DIM3}id: ${b?.id}${RESET3}`);
      break;
    }
    case "cancel": {
      const id = rest2.find((a) => !a.startsWith("--"));
      if (!id) fail2("cancel braucht eine Buchungs-ID");
      const { data, error } = await client.DELETE("/bookings/{id}", {
        params: { path: { id } }
      });
      if (!data) apiError(error);
      console.log(`${GREEN3}Storniert.${RESET3}`);
      break;
    }
    default:
      fail2(`Unbekannter Befehl: ${command2}`);
  }
}
