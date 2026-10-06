import WebSocket from "ws";
import { backoffDelay } from "./backoff.js";
import { formatLogLine } from "./format.js";
import { forwardRequest } from "./forward.js";
/** Close codes after which reconnecting cannot help. */
const FATAL_CLOSE = {
    4001: "Nicht angemeldet oder Anmeldung abgelaufen. Melde dich mit checkcourt login an.",
    4003: "Die CLI-Sitzung wurde beendet (widerrufen oder Organisation verlassen).",
    4004: "App nicht gefunden. Gib den Slug oder die ID einer App deiner Organisation an.",
    4009: "Die Organisation hat noch keinen Sandbox-Verein.",
};
export function relayUrl(host, app) {
    const url = new URL("/api/dev-relay", host);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("app", app);
    return url.toString();
}
/** Runs until Ctrl+C or a fatal close; reconnects with backoff otherwise. Resolves with the exit code. */
export function listen(options) {
    return new Promise((resolve) => {
        let attempt = 0;
        let stopping = false;
        let socket = null;
        let retry = null;
        const finish = (code) => {
            stopping = true;
            if (retry)
                clearTimeout(retry);
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
            resolve(code);
        };
        function stop() {
            socket?.close(1000);
            options.log("Weiterleitung beendet.");
            finish(0);
        }
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        const connect = () => {
            const ws = new WebSocket(relayUrl(options.host, options.app), {
                headers: { Authorization: `Bearer ${options.token}` },
            });
            socket = ws;
            ws.on("message", async (data) => {
                let message;
                try {
                    message = JSON.parse(data.toString());
                }
                catch {
                    return;
                }
                if (message.type === "ready") {
                    attempt = 0;
                    options.log(`Bereit. ${message.app.name} (${message.app.slug}) im Sandbox-Verein ${message.sandbox.name} wird an ${options.forwardTo} weitergeleitet. Beenden mit Ctrl+C.`);
                    if (message.installations === 0) {
                        options.log("Hinweis: Die App ist im Sandbox-Verein nicht installiert, es kommt also nichts an.");
                    }
                    return;
                }
                if (message.type !== "request")
                    return;
                const result = await forwardRequest(message, options);
                options.log(formatLogLine({
                    at: new Date(),
                    kind: message.kind,
                    label: message.meta.eventType ?? message.meta.point ?? message.path,
                    ...("error" in result ? { error: result.error } : { status: result.status }),
                    durationMs: result.durationMs,
                    target: result.url,
                }, { color: options.color }));
                if (ws.readyState !== WebSocket.OPEN)
                    return;
                ws.send(JSON.stringify("error" in result
                    ? { type: "response", id: result.id, error: result.error }
                    : { type: "response", id: result.id, status: result.status, body: result.body, duration_ms: result.durationMs }));
            });
            ws.on("error", () => {
                // Followed by "close", which decides about reconnecting.
            });
            ws.on("close", (code) => {
                if (stopping)
                    return;
                const fatal = FATAL_CLOSE[code];
                if (fatal) {
                    options.log(fatal);
                    finish(1);
                    return;
                }
                const delay = backoffDelay(attempt++);
                options.log(`Verbindung getrennt, neuer Versuch in ${Math.round(delay / 1000)} s ...`);
                retry = setTimeout(connect, delay);
            });
        };
        connect();
    });
}
