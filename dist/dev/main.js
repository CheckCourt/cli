import { resolveHost } from "../config.js";
import { DevApiError, storedSession } from "./api.js";
import { deliveries, formatDelivery, listTriggers, trigger } from "./commands.js";
import { listen } from "./listen.js";
import { login, logout } from "./login.js";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
function parse(args) {
    const flags = new Map();
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith("--")) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf("=");
        if (eq > 0)
            flags.set(arg.slice(2, eq), arg.slice(eq + 1));
        else if (args[i + 1] !== undefined && !args[i + 1].startsWith("--"))
            flags.set(arg.slice(2), args[++i]);
        else
            flags.set(arg.slice(2), true);
    }
    return { flags, positional };
}
function str(flags, name) {
    const v = flags.get(name);
    return typeof v === "string" ? v : undefined;
}
const log = (line) => console.log(line);
const fail = (message) => {
    console.error(`${RED}Fehler:${RESET} ${message}`);
    return 1;
};
/** login, logout, listen, trigger, logs; resolves with the process exit code. */
export async function runDevCommand(command, args) {
    const { flags, positional } = parse(args);
    const host = resolveHost(str(flags, "host"));
    try {
        if (command === "login") {
            await login(host, { browser: !flags.has("no-browser"), log });
            log(`${GREEN}Angemeldet.${RESET} ${DIM}Sitzungen verwaltest du im Entwicklerportal unter Organisation.${RESET}`);
            return 0;
        }
        const session = storedSession(host);
        if (command === "logout") {
            await logout(session?.host ?? host, session?.token);
            log("Abgemeldet.");
            return 0;
        }
        if (!session)
            return fail("Nicht angemeldet. Zuerst: checkcourt login");
        if (command === "trigger" && flags.has("list")) {
            for (const e of await listTriggers(session.host, session.token))
                log(`  ${e.type.padEnd(22)} ${DIM}${e.description}${RESET}`);
            return 0;
        }
        const app = str(flags, "app");
        if (!app)
            return fail(`${command} braucht --app <slug>`);
        if (command === "listen") {
            const forwardTo = str(flags, "forward-to");
            if (!forwardTo)
                return fail("listen braucht --forward-to, z. B. http://localhost:4000");
            return await listen({
                host: session.host,
                token: session.token,
                app,
                forwardTo,
                webhookPath: str(flags, "webhook-path"),
                extensionPath: str(flags, "extension-path"),
                log,
                color: process.stdout.isTTY,
            });
        }
        if (command === "trigger") {
            const event = positional[0];
            if (!event)
                return fail("trigger braucht ein Ereignis, z. B. booking.created (Liste: checkcourt trigger --list)");
            const result = await trigger(session.host, session.token, app, event);
            log(`${GREEN}Ausgelöst:${RESET} ${result.event} ${DIM}(${result.object.type} ${result.object.id})${RESET}`);
            return 0;
        }
        if (command === "logs") {
            const seen = new Set();
            const print = async () => {
                const rows = await deliveries(session.host, session.token, app);
                for (const d of rows.reverse()) {
                    const key = `${d.id}:${d.status}:${d.attempts}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    log(formatDelivery(d));
                }
            };
            await print();
            if (!flags.has("follow"))
                return 0;
            for (;;) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await print();
            }
        }
        return fail(`Unbekannter Befehl: ${command}`);
    }
    catch (err) {
        if (err instanceof DevApiError)
            return fail(err.message);
        if (err instanceof Error && "cause" in err)
            return fail(`${host} nicht erreichbar (${err.message})`);
        throw err;
    }
}
