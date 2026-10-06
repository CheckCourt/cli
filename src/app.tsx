import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { createCheckCourtClient, type CheckCourtClient } from "./client.js";
import { resolveConfig, saveConfig, type CliConfig } from "./config.js";

type Tenant = { id: string; name: string; role: string };
type Slot = { courtId: number; courtName: string; time: string };
type Booking = {
  id: string;
  courtName?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  cancelledAt?: string | null;
};

type Screen =
  | "setup-key"
  | "setup-url"
  | "tenants"
  | "menu"
  | "courts"
  | "slots"
  | "book"
  | "bookings";

type CourtSlots = { courtId: number; courtName: string; slots: string[] };

function describeError(error: unknown): string {
  const e = error as { error?: { code?: string; message?: string } } | undefined;
  if (e?.error?.message) return `${e.error.code}: ${e.error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Header({ config }: { config: CliConfig }) {
  return (
    <Box
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text>
        <Text color="green" bold>
          ● CheckCourt
        </Text>
        {config.tenantName ? <Text> · {config.tenantName}</Text> : null}
      </Text>
      <Text dimColor>{config.baseUrl}</Text>
    </Box>
  );
}

function Footer({ hints }: { hints: string }) {
  return (
    <Box paddingX={1}>
      <Text dimColor>{hints}</Text>
    </Box>
  );
}

function SelectList<T>({
  items,
  onSelect,
  onBack,
  emptyText,
}: {
  items: { label: string; hint?: string; value: T }[];
  onSelect: (value: T) => void;
  onBack?: () => void;
  emptyText?: string;
}) {
  const [index, setIndex] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setIndex((i) => Math.min(items.length - 1, i + 1));
    if (key.return && items[index]) onSelect(items[index].value);
    if (key.escape && onBack) onBack();
  });

  if (items.length === 0) {
    return <Text dimColor>{emptyText ?? "Keine Einträge"}</Text>;
  }
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={i} color={i === index ? "green" : undefined}>
          {i === index ? "❯ " : "  "}
          {item.label}
          {item.hint ? <Text dimColor> {item.hint}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const [config, setConfig] = useState<CliConfig>(() => resolveConfig());
  const [client, setClient] = useState<CheckCourtClient | null>(() => {
    const c = resolveConfig();
    return c.apiKey && c.baseUrl
      ? createCheckCourtClient({
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          tenantId: c.tenantId,
        })
      : null;
  });
  const [screen, setScreen] = useState<Screen>(() => {
    const c = resolveConfig();
    if (!c.apiKey) return "setup-key";
    return c.tenantId ? "menu" : "tenants";
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyConfig = (next: CliConfig) => {
    saveConfig(next);
    setConfig(next);
    if (next.apiKey && next.baseUrl) {
      setClient(
        createCheckCourtClient({
          baseUrl: next.baseUrl,
          apiKey: next.apiKey,
          tenantId: next.tenantId,
        }),
      );
    }
  };

  // ----- Setup -----
  const [keyDraft, setKeyDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState(
    config.baseUrl ?? "https://app.checkcourt.de/api/v1",
  );

  // ----- Tenants -----
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  useEffect(() => {
    if (screen !== "tenants" || !client) return;
    setTenants(null);
    setError(null);
    client
      .GET("/me/tenants")
      .then(({ data, error: err }) => {
        if (!data) return setError(describeError(err));
        setTenants((data.tenants ?? []) as Tenant[]);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [screen, client]);

  // ----- Courts & Slots -----
  const [date, setDate] = useState(() => addDays(new Date().toISOString().slice(0, 10), 1));
  const [courtSlots, setCourtSlots] = useState<CourtSlots[] | null>(null);
  const [selectedCourt, setSelectedCourt] = useState<CourtSlots | null>(null);
  const [courtIndex, setCourtIndex] = useState(0);
  const [slotIndex, setSlotIndex] = useState(0);
  const [slotQuery, setSlotQuery] = useState("");
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);

  useEffect(() => {
    if ((screen !== "courts" && screen !== "slots") || !client) return;
    setCourtSlots(null);
    setError(null);
    client
      .GET("/availability/slots", { params: { query: { date, durationMinutes: 60 } } })
      .then(({ data, error: err }) => {
        if (!data) return setError(describeError(err));
        setCourtSlots(
          (data.courts ?? []).map((c) => ({
            courtId: c.courtId!,
            courtName: c.courtName!,
            slots: c.slots ?? [],
          })),
        );
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [screen === "courts" || screen === "slots", client, date]);

  // The slots of the chosen court refresh with the date; keep the selection
  // pointed at the freshest data.
  const activeCourt =
    courtSlots?.find((c) => c.courtId === selectedCourt?.courtId) ?? null;
  const filteredSlots = (activeCourt?.slots ?? []).filter((t) =>
    t.startsWith(slotQuery),
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
    { isActive: screen === "courts" },
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
          time: filteredSlots[slotIndex],
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
      // Type-to-search: digits and colon narrow the start times live.
      if (/^[0-9:]$/.test(input)) {
        setSlotQuery((q) => (q + input).slice(0, 5));
        setSlotIndex(0);
      }
    },
    { isActive: screen === "slots" },
  );

  // ----- Book -----
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
          players: guestDraft.trim()
            ? [{ isGuest: true, guestName: guestDraft.trim() }]
            : [],
        },
      });
      if (!data) {
        setError(describeError(err));
        setScreen("slots");
        return;
      }
      setNotice(
        `Gebucht: ${slot.courtName} am ${date}, ${slot.time}-${end.slice(0, 5)}`,
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
    { isActive: screen === "book" },
  );

  // ----- Bookings -----
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  useEffect(() => {
    if (screen !== "bookings" || !client) return;
    setBookings(null);
    setError(null);
    client
      .GET("/me/bookings")
      .then(({ data, error: err }) => {
        if (!data) return setError(describeError(err));
        setBookings((data.bookings ?? []) as Booking[]);
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [screen, client]);

  const cancelBooking = async (id: string) => {
    if (!client) return;
    setError(null);
    try {
      const { data, error: err } = await client.DELETE("/bookings/{id}", {
        params: { path: { id } },
      });
      if (!data) return setError(describeError(err));
      setNotice("Buchung storniert");
      setBookings((b) => (b ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(describeError(e));
    }
  };

  // ----- Screens -----
  let body = null;
  let hints = "↑↓ wählen · Enter ok · Esc zurück";

  if (screen === "setup-key") {
    hints = "Enter bestätigen";
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>Willkommen! Persönlichen API-Schlüssel einrichten</Text>
        <Text dimColor>
          Zu finden in der App unter Einstellungen → API-Schlüssel
        </Text>
        <Box>
          <Text>Schlüssel: </Text>
          <TextInput
            value={keyDraft}
            onChange={setKeyDraft}
            mask="*"
            onSubmit={(value) => {
              if (!value.trim()) return;
              setScreen("setup-url");
            }}
          />
        </Box>
      </Box>
    );
  } else if (screen === "setup-url") {
    hints = "Enter bestätigen";
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>API-Basis-URL</Text>
        <Box>
          <Text>URL: </Text>
          <TextInput
            value={urlDraft}
            onChange={setUrlDraft}
            onSubmit={(value) => {
              applyConfig({
                ...config,
                apiKey: keyDraft.trim(),
                baseUrl: value.trim() || "https://app.checkcourt.de/api/v1",
                tenantId: undefined,
                tenantName: undefined,
              });
              setScreen("tenants");
            }}
          />
        </Box>
      </Box>
    );
  } else if (screen === "tenants") {
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>Verein wählen</Text>
        {tenants === null && !error ? (
          <Text dimColor>Lade Vereine…</Text>
        ) : (
          <SelectList
            items={(tenants ?? []).map((t) => ({
              label: t.name,
              hint: `(${t.role})`,
              value: t,
            }))}
            emptyText="Keine Vereine gefunden"
            onSelect={(t) => {
              applyConfig({ ...config, tenantId: t.id, tenantName: t.name });
              setScreen("menu");
            }}
          />
        )}
      </Box>
    );
  } else if (screen === "menu") {
    hints = "↑↓ wählen · Enter ok · q beenden";
    body = (
      <SelectList
        items={[
          { label: "Freie Slots & Buchen", value: "courts" as const },
          { label: "Meine Buchungen", value: "bookings" as const },
          { label: "Verein wechseln", value: "tenants" as const },
          { label: "Schlüssel ändern", value: "setup-key" as const },
          { label: "Beenden", value: "exit" as const },
        ]}
        onSelect={(value) => {
          setNotice(null);
          if (value === "exit") return exit();
          setScreen(value);
        }}
      />
    );
  } else if (screen === "courts") {
    hints = "←→ Tag · ↑↓ Platz · Enter wählen · Esc zurück";
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          Platz wählen <Text dimColor>· {date} · 60 Min</Text>
        </Text>
        {courtSlots === null && !error ? (
          <Text dimColor>Lade Plätze…</Text>
        ) : (
          <Box flexDirection="column">
            {(courtSlots ?? []).map((c, i) => (
              <Text key={c.courtId} color={i === courtIndex ? "green" : undefined}>
                {i === courtIndex ? "❯ " : "  "}
                {c.courtName}{" "}
                <Text dimColor>
                  ·{" "}
                  {c.slots.length === 0
                    ? "keine freien Slots"
                    : `${c.slots.length} freie Slots (${c.slots[0]}-${c.slots[c.slots.length - 1]})`}
                </Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  } else if (screen === "slots") {
    hints = "Ziffern tippen = Suche · ←→ Tag · ↑↓ Slot · Enter buchen · Esc zurück";
    const windowSize = 10;
    const offset = Math.max(
      0,
      Math.min(slotIndex - Math.floor(windowSize / 2), filteredSlots.length - windowSize),
    );
    const visible = filteredSlots.slice(offset, offset + windowSize);
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {activeCourt?.courtName ?? "Platz"} <Text dimColor>· {date} · 60 Min</Text>
        </Text>
        <Text>
          Suche: {slotQuery ? <Text color="green">{slotQuery}</Text> : <Text dimColor>tippe z.B. 18</Text>}
          {slotQuery ? (
            <Text dimColor>
              {" "}
              · {filteredSlots.length} Treffer
            </Text>
          ) : null}
        </Text>
        {courtSlots === null && !error ? (
          <Text dimColor>Lade Slots…</Text>
        ) : filteredSlots.length === 0 ? (
          <Text dimColor>
            {slotQuery ? "Keine Startzeit passt zur Suche" : "Keine freien Slots an diesem Tag"}
          </Text>
        ) : (
          <Box flexDirection="column">
            {offset > 0 ? <Text dimColor>  ↑ {offset} weitere</Text> : null}
            {visible.map((time, i) => {
              const realIndex = offset + i;
              return (
                <Text key={time} color={realIndex === slotIndex ? "green" : undefined}>
                  {realIndex === slotIndex ? "❯ " : "  "}
                  {time}
                  <Text dimColor>
                    {" "}
                    - {`${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`}
                  </Text>
                </Text>
              );
            })}
            {offset + windowSize < filteredSlots.length ? (
              <Text dimColor>  ↓ {filteredSlots.length - offset - windowSize} weitere</Text>
            ) : null}
          </Box>
        )}
      </Box>
    );
  } else if (screen === "book") {
    const slot = pendingSlot;
    hints = "Enter buchen · Esc abbrechen";
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          Buchen: {slot?.courtName} am {date}, {slot?.time} (60 Min)
        </Text>
        <Box>
          <Text>Gastname (leer = ohne Gast): </Text>
          <TextInput
            value={guestDraft}
            onChange={setGuestDraft}
            onSubmit={() => void submitBooking()}
          />
        </Box>
        {booking ? <Text color="yellow">Buche…</Text> : null}
      </Box>
    );
  } else if (screen === "bookings") {
    hints = "↑↓ wählen · Enter stornieren · Esc zurück";
    body = (
      <Box flexDirection="column" gap={1}>
        <Text bold>Meine Buchungen</Text>
        {bookings === null && !error ? (
          <Text dimColor>Lade Buchungen…</Text>
        ) : (
          <SelectList
            items={(bookings ?? [])
              .filter((b) => !b.cancelledAt)
              .map((b) => ({
                label: `${b.date}  ${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}  ${b.courtName}`,
                value: b.id,
              }))}
            emptyText="Keine anstehenden Buchungen"
            onSelect={(id) => void cancelBooking(id)}
            onBack={() => setScreen("menu")}
          />
        )}
      </Box>
    );
  }

  useInput(
    (input) => {
      if (input === "q") exit();
    },
    { isActive: screen === "menu" },
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Header config={config} />
      <Box paddingX={1} flexDirection="column" gap={1}>
        {notice ? <Text color="green">{notice}</Text> : null}
        {error ? <Text color="red">Fehler: {error}</Text> : null}
        {body}
      </Box>
      <Footer hints={hints} />
    </Box>
  );
}
