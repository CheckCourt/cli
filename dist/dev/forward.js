const MAX_BODY = 256 * 1024;
const HOP_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding"]);
export function targetUrl(request, options) {
    const override = request.kind === "webhook" ? options.webhookPath : options.extensionPath;
    const path = override ?? request.path ?? "/";
    return new URL(path.startsWith("/") ? path : `/${path}`, options.forwardTo).toString();
}
/** Replays the request against the local app, unchanged headers and body so signatures still verify. */
export async function forwardRequest(request, options) {
    const doFetch = options.fetch ?? fetch;
    const url = targetUrl(request, options);
    const headers = {};
    for (const [k, v] of Object.entries(request.headers)) {
        if (!HOP_HEADERS.has(k.toLowerCase()))
            headers[k] = v;
    }
    const started = Date.now();
    // Leave the platform a moment to receive the answer before its own deadline.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(200, request.timeoutMs - 300));
    try {
        const res = await doFetch(url, { method: request.method, headers, body: request.body, signal: controller.signal });
        const body = (await res.text()).slice(0, MAX_BODY);
        return { id: request.id, status: res.status, body, durationMs: Date.now() - started, url };
    }
    catch (err) {
        const cause = err.cause?.code;
        const message = controller.signal.aborted
            ? "Zeitüberschreitung"
            : (cause ?? (err instanceof Error ? err.message : String(err)));
        return { id: request.id, error: message, durationMs: Date.now() - started, url };
    }
    finally {
        clearTimeout(timer);
    }
}
