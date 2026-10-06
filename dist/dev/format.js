const KIND_LABELS = {
    webhook: "webhook",
    extension_render: "extension",
    extension_action: "action",
};
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
function paint(color, code, text) {
    return color ? `${code}${text}${RESET}` : text;
}
function clock(at) {
    return [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
/** One line per relayed request: time, kind, event or point, local result, duration. */
export function formatLogLine(input, options = {}) {
    const color = options.color ?? false;
    const result = input.error
        ? paint(color, RED, `fehler ${input.error}`)
        : paint(color, input.status < 300 ? GREEN : input.status < 500 ? YELLOW : RED, String(input.status));
    const parts = [
        paint(color, DIM, clock(input.at)),
        KIND_LABELS[input.kind].padEnd(9),
        input.label.padEnd(22),
        `-> ${result}`,
        paint(color, DIM, `${input.durationMs} ms`),
    ];
    if (input.target)
        parts.push(paint(color, DIM, input.target));
    return parts.join("  ");
}
