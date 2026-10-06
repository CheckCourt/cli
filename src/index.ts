#!/usr/bin/env node
import { render } from "ink";
import { createElement } from "react";
import { createCheckCourtClient } from "./client.js";
import { resolveConfig } from "./config.js";
import { runDevCommand } from "./dev/main.js";
import { App } from "./app.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const HELP = `${BOLD}checkcourt${RESET} - CheckCourt API Demo-CLI (persönlicher Schlüssel)

Konfiguration über Umgebungsvariablen:
  CHECKCOURT_API_KEY    Persönlicher API-Schlüssel (ck_user_…), erforderlich
  CHECKCOURT_TENANT_ID  Vereins-ID für vereinsbezogene Befehle (siehe "tenants")
  CHECKCOURT_BASE_URL   Default: https://app.checkcourt.de/api/v1

Befehle:
  tenants                          Meine Vereine samt Rolle auflisten
  slots [--date D] [--duration M]  Buchbare Startzeiten pro Platz (Default: morgen, 60 Min)
  bookings                         Meine anstehenden Buchungen
  book --court ID --date D --start HH:MM --end HH:MM [--guest NAME] [--title T]
                                   Platz für mich buchen
  cancel <buchungs-id>             Buchung stornieren

Entwicklung von Apps (Anmeldung per Browser, kein API-Schlüssel nötig):
  login [--no-browser]             CLI für deine Entwickler-Organisationen anmelden
  logout                           Abmelden und die CLI-Sitzung beenden
  listen --app SLUG --forward-to URL [--webhook-path P] [--extension-path P]
                                   Webhooks und Erweiterungen aus dem Sandbox-Verein
                                   an deine lokale App weiterleiten
  trigger <ereignis> --app SLUG    Testereignis im Sandbox-Verein auslösen
  trigger --list                   Auslösbare Ereignisse anzeigen
  logs --app SLUG [--follow]       Zustellungen an den Sandbox-Verein anzeigen
  (Host: --host oder CHECKCOURT_HOST, Default: https://app.checkcourt.de)
`;

function fail(message: string): never {
  console.error(`${RED}Fehler:${RESET} ${message}`);
  process.exit(1);
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
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

function apiError(error: unknown): never {
  const e = error as { error?: { code?: string; message?: string } } | undefined;
  fail(e?.error ? `${e.error.code}: ${e.error.message}` : JSON.stringify(error));
}

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

const COMMANDS = ["tenants", "slots", "bookings", "book", "cancel"];
const DEV_COMMANDS = ["login", "logout", "listen", "trigger", "logs"];

const [command, ...rest] = process.argv.slice(2);

// No command: launch the interactive app (the one-shot commands below stay
// for scripting).
if (!command) {
  if (!process.stdin.isTTY) {
    fail("Kein Terminal erkannt. Für Skripte: checkcourt help");
  }
  render(createElement(App));
} else {
  await runCommand(command, rest);
}

async function runCommand(command: string, rest: string[]): Promise<void> {
if (command === "help") {
  console.log(HELP);
  process.exit(0);
}
if (DEV_COMMANDS.includes(command)) {
  process.exit(await runDevCommand(command, rest));
}
if (!COMMANDS.includes(command)) {
  console.log(HELP);
  fail(`Unbekannter Befehl: ${command}`);
}

const config = resolveConfig();
const apiKey = config.apiKey;
if (!apiKey) fail("CHECKCOURT_API_KEY ist nicht gesetzt (oder einmal interaktiv anmelden: checkcourt)");

const client = createCheckCourtClient({
  baseUrl: config.baseUrl!,
  apiKey,
  tenantId: config.tenantId,
});

const flags = parseFlags(rest);

switch (command) {
  case "tenants": {
    const { data, error } = await client.GET("/me/tenants");
    if (!data) apiError(error);
    console.log(`${BOLD}Meine Vereine${RESET}`);
    for (const t of data.tenants ?? []) {
      console.log(`  ${t.name}  ${DIM}(${(t.roles ?? []).map((r) => r.name).join(", ")})${RESET}`);
      console.log(`    ${DIM}id: ${t.id}${RESET}`);
    }
    break;
  }

  case "slots": {
    const date = flags.get("date") ?? tomorrow();
    const durationMinutes = Number(flags.get("duration") ?? 60);
    const { data, error } = await client.GET("/availability/slots", {
      params: { query: { date, durationMinutes } },
    });
    if (!data) apiError(error);
    console.log(`${BOLD}Freie Slots am ${data.date}${RESET} ${DIM}(${data.durationMinutes} Min)${RESET}`);
    for (const c of data.courts ?? []) {
      const slots = c.slots ?? [];
      console.log(
        `  ${c.courtName}: ${slots.length ? slots.join("  ") : `${DIM}keine${RESET}`}`,
      );
    }
    break;
  }

  case "bookings": {
    const { data, error } = await client.GET("/me/bookings");
    if (!data) apiError(error);
    console.log(`${BOLD}Meine Buchungen${RESET}`);
    const bookings = data.bookings ?? [];
    if (bookings.length === 0) console.log(`  ${DIM}keine anstehenden Buchungen${RESET}`);
    for (const b of bookings) {
      const time = `${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}`;
      const status = b.cancelledAt ? ` ${RED}storniert${RESET}` : "";
      console.log(`  ${b.date}  ${time}  ${b.courtName}${status}`);
      console.log(`    ${DIM}id: ${b.id}${RESET}`);
    }
    break;
  }

  case "book": {
    const courtId = Number(flags.get("court"));
    const date = flags.get("date");
    const startTime = flags.get("start");
    const endTime = flags.get("end");
    if (!courtId || !date || !startTime || !endTime) {
      fail("book braucht --court, --date, --start und --end");
    }
    const guest = flags.get("guest");
    const { data, error } = await client.POST("/me/bookings", {
      body: {
        courtId,
        date,
        startTime,
        endTime,
        title: flags.get("title"),
        players: guest ? [{ isGuest: true, guestName: guest }] : [],
      },
    });
    if (!data) apiError(error);
    const b = data.booking;
    console.log(
      `${GREEN}Gebucht:${RESET} Platz ${b?.courtId} am ${b?.date}, ${b?.startTime}-${b?.endTime}`,
    );
    console.log(`  ${DIM}id: ${b?.id}${RESET}`);
    break;
  }

  case "cancel": {
    const id = rest.find((a) => !a.startsWith("--"));
    if (!id) fail("cancel braucht eine Buchungs-ID");
    const { data, error } = await client.DELETE("/bookings/{id}", {
      params: { path: { id } },
    });
    if (!data) apiError(error);
    console.log(`${GREEN}Storniert.${RESET}`);
    break;
  }

  default:
    fail(`Unbekannter Befehl: ${command}`);
}
}
