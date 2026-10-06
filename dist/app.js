import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { createCheckCourtClient } from "./client.js";
import { resolveConfig, saveConfig } from "./config.js";
function describeError(error) {
    const e = error;
    if (e?.error?.message)
        return `${e.error.code}: ${e.error.message}`;
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function addDays(date, days) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}
function Header({ config }) {
    return (_jsxs(Box, { borderStyle: "round", borderColor: "green", paddingX: 1, justifyContent: "space-between", children: [_jsxs(Text, { children: [_jsx(Text, { color: "green", bold: true, children: "\u25CF CheckCourt" }), config.tenantName ? _jsxs(Text, { children: [" \u00B7 ", config.tenantName] }) : null] }), _jsx(Text, { dimColor: true, children: config.baseUrl })] }));
}
function Footer({ hints }) {
    return (_jsx(Box, { paddingX: 1, children: _jsx(Text, { dimColor: true, children: hints }) }));
}
function SelectList({ items, onSelect, onBack, emptyText, }) {
    const [index, setIndex] = useState(0);
    useInput((_input, key) => {
        if (key.upArrow)
            setIndex((i) => Math.max(0, i - 1));
        if (key.downArrow)
            setIndex((i) => Math.min(items.length - 1, i + 1));
        if (key.return && items[index])
            onSelect(items[index].value);
        if (key.escape && onBack)
            onBack();
    });
    if (items.length === 0) {
        return _jsx(Text, { dimColor: true, children: emptyText ?? "Keine Einträge" });
    }
    return (_jsx(Box, { flexDirection: "column", children: items.map((item, i) => (_jsxs(Text, { color: i === index ? "green" : undefined, children: [i === index ? "❯ " : "  ", item.label, item.hint ? _jsxs(Text, { dimColor: true, children: [" ", item.hint] }) : null] }, i))) }));
}
export function App() {
    const { exit } = useApp();
    const [config, setConfig] = useState(() => resolveConfig());
    const [client, setClient] = useState(() => {
        const c = resolveConfig();
        return c.apiKey && c.baseUrl
            ? createCheckCourtClient({
                baseUrl: c.baseUrl,
                apiKey: c.apiKey,
                tenantId: c.tenantId,
            })
            : null;
    });
    const [screen, setScreen] = useState(() => {
        const c = resolveConfig();
        if (!c.apiKey)
            return "setup-key";
        return c.tenantId ? "menu" : "tenants";
    });
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const applyConfig = (next) => {
        saveConfig(next);
        setConfig(next);
        if (next.apiKey && next.baseUrl) {
            setClient(createCheckCourtClient({
                baseUrl: next.baseUrl,
                apiKey: next.apiKey,
                tenantId: next.tenantId,
            }));
        }
    };
    // ----- Setup -----
    const [keyDraft, setKeyDraft] = useState("");
    const [urlDraft, setUrlDraft] = useState(config.baseUrl ?? "https://app.checkcourt.de/api/v1");
    // ----- Tenants -----
    const [tenants, setTenants] = useState(null);
    useEffect(() => {
        if (screen !== "tenants" || !client)
            return;
        setTenants(null);
        setError(null);
        client
            .GET("/me/tenants")
            .then(({ data, error: err }) => {
            if (!data)
                return setError(describeError(err));
            setTenants((data.tenants ?? []));
        })
            .catch((e) => setError(describeError(e)));
    }, [screen, client]);
    // ----- Courts & Slots -----
    const [date, setDate] = useState(() => addDays(new Date().toISOString().slice(0, 10), 1));
    const [courtSlots, setCourtSlots] = useState(null);
    const [selectedCourt, setSelectedCourt] = useState(null);
    const [courtIndex, setCourtIndex] = useState(0);
    const [slotIndex, setSlotIndex] = useState(0);
    const [slotQuery, setSlotQuery] = useState("");
    const [pendingSlot, setPendingSlot] = useState(null);
    useEffect(() => {
        if ((screen !== "courts" && screen !== "slots") || !client)
            return;
        setCourtSlots(null);
        setError(null);
        client
            .GET("/availability/slots", { params: { query: { date, durationMinutes: 60 } } })
            .then(({ data, error: err }) => {
            if (!data)
                return setError(describeError(err));
            setCourtSlots((data.courts ?? []).map((c) => ({
                courtId: c.courtId,
                courtName: c.courtName,
                slots: c.slots ?? [],
            })));
        })
            .catch((e) => setError(describeError(e)));
    }, [screen === "courts" || screen === "slots", client, date]);
    // The slots of the chosen court refresh with the date; keep the selection
    // pointed at the freshest data.
    const activeCourt = courtSlots?.find((c) => c.courtId === selectedCourt?.courtId) ?? null;
    const filteredSlots = (activeCourt?.slots ?? []).filter((t) => t.startsWith(slotQuery));
    useInput((_input, key) => {
        const courts = courtSlots ?? [];
        if (key.leftArrow)
            setDate((d) => addDays(d, -1));
        if (key.rightArrow)
            setDate((d) => addDays(d, 1));
        if (key.upArrow)
            setCourtIndex((i) => Math.max(0, i - 1));
        if (key.downArrow)
            setCourtIndex((i) => Math.min(courts.length - 1, i + 1));
        if (key.return && courts[courtIndex]) {
            setSelectedCourt(courts[courtIndex]);
            setSlotQuery("");
            setSlotIndex(0);
            setScreen("slots");
        }
        if (key.escape)
            setScreen("menu");
    }, { isActive: screen === "courts" });
    useInput((input, key) => {
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
        if (key.upArrow)
            setSlotIndex((i) => Math.max(0, i - 1));
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
            }
            else {
                setScreen("courts");
            }
            return;
        }
        // Type-to-search: digits and colon narrow the start times live.
        if (/^[0-9:]$/.test(input)) {
            setSlotQuery((q) => (q + input).slice(0, 5));
            setSlotIndex(0);
        }
    }, { isActive: screen === "slots" });
    // ----- Book -----
    const [guestDraft, setGuestDraft] = useState("");
    const [booking, setBooking] = useState(false);
    const submitBooking = async () => {
        const slot = pendingSlot;
        if (!slot || !client || booking)
            return;
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
            setNotice(`Gebucht: ${slot.courtName} am ${date}, ${slot.time}-${end.slice(0, 5)}`);
            setScreen("menu");
        }
        catch (e) {
            setError(describeError(e));
            setScreen("slots");
        }
        finally {
            setBooking(false);
        }
    };
    useInput((_input, key) => {
        if (key.escape)
            setScreen("slots");
    }, { isActive: screen === "book" });
    // ----- Bookings -----
    const [bookings, setBookings] = useState(null);
    useEffect(() => {
        if (screen !== "bookings" || !client)
            return;
        setBookings(null);
        setError(null);
        client
            .GET("/me/bookings")
            .then(({ data, error: err }) => {
            if (!data)
                return setError(describeError(err));
            setBookings((data.bookings ?? []));
        })
            .catch((e) => setError(describeError(e)));
    }, [screen, client]);
    const cancelBooking = async (id) => {
        if (!client)
            return;
        setError(null);
        try {
            const { data, error: err } = await client.DELETE("/bookings/{id}", {
                params: { path: { id } },
            });
            if (!data)
                return setError(describeError(err));
            setNotice("Buchung storniert");
            setBookings((b) => (b ?? []).filter((x) => x.id !== id));
        }
        catch (e) {
            setError(describeError(e));
        }
    };
    // ----- Screens -----
    let body = null;
    let hints = "↑↓ wählen · Enter ok · Esc zurück";
    if (screen === "setup-key") {
        hints = "Enter bestätigen";
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { bold: true, children: "Willkommen! Pers\u00F6nlichen API-Schl\u00FCssel einrichten" }), _jsx(Text, { dimColor: true, children: "Zu finden in der App unter Einstellungen \u2192 API-Schl\u00FCssel" }), _jsxs(Box, { children: [_jsx(Text, { children: "Schl\u00FCssel: " }), _jsx(TextInput, { value: keyDraft, onChange: setKeyDraft, mask: "*", onSubmit: (value) => {
                                if (!value.trim())
                                    return;
                                setScreen("setup-url");
                            } })] })] }));
    }
    else if (screen === "setup-url") {
        hints = "Enter bestätigen";
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { bold: true, children: "API-Basis-URL" }), _jsxs(Box, { children: [_jsx(Text, { children: "URL: " }), _jsx(TextInput, { value: urlDraft, onChange: setUrlDraft, onSubmit: (value) => {
                                applyConfig({
                                    ...config,
                                    apiKey: keyDraft.trim(),
                                    baseUrl: value.trim() || "https://app.checkcourt.de/api/v1",
                                    tenantId: undefined,
                                    tenantName: undefined,
                                });
                                setScreen("tenants");
                            } })] })] }));
    }
    else if (screen === "tenants") {
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { bold: true, children: "Verein w\u00E4hlen" }), tenants === null && !error ? (_jsx(Text, { dimColor: true, children: "Lade Vereine\u2026" })) : (_jsx(SelectList, { items: (tenants ?? []).map((t) => ({
                        label: t.name,
                        hint: `(${t.role})`,
                        value: t,
                    })), emptyText: "Keine Vereine gefunden", onSelect: (t) => {
                        applyConfig({ ...config, tenantId: t.id, tenantName: t.name });
                        setScreen("menu");
                    } }))] }));
    }
    else if (screen === "menu") {
        hints = "↑↓ wählen · Enter ok · q beenden";
        body = (_jsx(SelectList, { items: [
                { label: "Freie Slots & Buchen", value: "courts" },
                { label: "Meine Buchungen", value: "bookings" },
                { label: "Verein wechseln", value: "tenants" },
                { label: "Schlüssel ändern", value: "setup-key" },
                { label: "Beenden", value: "exit" },
            ], onSelect: (value) => {
                setNotice(null);
                if (value === "exit")
                    return exit();
                setScreen(value);
            } }));
    }
    else if (screen === "courts") {
        hints = "←→ Tag · ↑↓ Platz · Enter wählen · Esc zurück";
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsxs(Text, { bold: true, children: ["Platz w\u00E4hlen ", _jsxs(Text, { dimColor: true, children: ["\u00B7 ", date, " \u00B7 60 Min"] })] }), courtSlots === null && !error ? (_jsx(Text, { dimColor: true, children: "Lade Pl\u00E4tze\u2026" })) : (_jsx(Box, { flexDirection: "column", children: (courtSlots ?? []).map((c, i) => (_jsxs(Text, { color: i === courtIndex ? "green" : undefined, children: [i === courtIndex ? "❯ " : "  ", c.courtName, " ", _jsxs(Text, { dimColor: true, children: ["\u00B7", " ", c.slots.length === 0
                                        ? "keine freien Slots"
                                        : `${c.slots.length} freie Slots (${c.slots[0]}-${c.slots[c.slots.length - 1]})`] })] }, c.courtId))) }))] }));
    }
    else if (screen === "slots") {
        hints = "Ziffern tippen = Suche · ←→ Tag · ↑↓ Slot · Enter buchen · Esc zurück";
        const windowSize = 10;
        const offset = Math.max(0, Math.min(slotIndex - Math.floor(windowSize / 2), filteredSlots.length - windowSize));
        const visible = filteredSlots.slice(offset, offset + windowSize);
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsxs(Text, { bold: true, children: [activeCourt?.courtName ?? "Platz", " ", _jsxs(Text, { dimColor: true, children: ["\u00B7 ", date, " \u00B7 60 Min"] })] }), _jsxs(Text, { children: ["Suche: ", slotQuery ? _jsx(Text, { color: "green", children: slotQuery }) : _jsx(Text, { dimColor: true, children: "tippe z.B. 18" }), slotQuery ? (_jsxs(Text, { dimColor: true, children: [" ", "\u00B7 ", filteredSlots.length, " Treffer"] })) : null] }), courtSlots === null && !error ? (_jsx(Text, { dimColor: true, children: "Lade Slots\u2026" })) : filteredSlots.length === 0 ? (_jsx(Text, { dimColor: true, children: slotQuery ? "Keine Startzeit passt zur Suche" : "Keine freien Slots an diesem Tag" })) : (_jsxs(Box, { flexDirection: "column", children: [offset > 0 ? _jsxs(Text, { dimColor: true, children: ["  \u2191 ", offset, " weitere"] }) : null, visible.map((time, i) => {
                            const realIndex = offset + i;
                            return (_jsxs(Text, { color: realIndex === slotIndex ? "green" : undefined, children: [realIndex === slotIndex ? "❯ " : "  ", time, _jsxs(Text, { dimColor: true, children: [" ", "- ", `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`] })] }, time));
                        }), offset + windowSize < filteredSlots.length ? (_jsxs(Text, { dimColor: true, children: ["  \u2193 ", filteredSlots.length - offset - windowSize, " weitere"] })) : null] }))] }));
    }
    else if (screen === "book") {
        const slot = pendingSlot;
        hints = "Enter buchen · Esc abbrechen";
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsxs(Text, { bold: true, children: ["Buchen: ", slot?.courtName, " am ", date, ", ", slot?.time, " (60 Min)"] }), _jsxs(Box, { children: [_jsx(Text, { children: "Gastname (leer = ohne Gast): " }), _jsx(TextInput, { value: guestDraft, onChange: setGuestDraft, onSubmit: () => void submitBooking() })] }), booking ? _jsx(Text, { color: "yellow", children: "Buche\u2026" }) : null] }));
    }
    else if (screen === "bookings") {
        hints = "↑↓ wählen · Enter stornieren · Esc zurück";
        body = (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Text, { bold: true, children: "Meine Buchungen" }), bookings === null && !error ? (_jsx(Text, { dimColor: true, children: "Lade Buchungen\u2026" })) : (_jsx(SelectList, { items: (bookings ?? [])
                        .filter((b) => !b.cancelledAt)
                        .map((b) => ({
                        label: `${b.date}  ${b.startTime?.slice(0, 5)}-${b.endTime?.slice(0, 5)}  ${b.courtName}`,
                        value: b.id,
                    })), emptyText: "Keine anstehenden Buchungen", onSelect: (id) => void cancelBooking(id), onBack: () => setScreen("menu") }))] }));
    }
    useInput((input) => {
        if (input === "q")
            exit();
    }, { isActive: screen === "menu" });
    return (_jsxs(Box, { flexDirection: "column", gap: 1, children: [_jsx(Header, { config: config }), _jsxs(Box, { paddingX: 1, flexDirection: "column", gap: 1, children: [notice ? _jsx(Text, { color: "green", children: notice }) : null, error ? _jsxs(Text, { color: "red", children: ["Fehler: ", error] }) : null, body] }), _jsx(Footer, { hints: hints })] }));
}
