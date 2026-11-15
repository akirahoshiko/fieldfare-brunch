import { DurableObject } from "cloudflare:workers";
import { MENU, OPTIONS, priceLine, findItem, type CartLine, type PricedLine } from "./menu";
import { london, DEFAULT_HOURS, LAST_ORDER_BEFORE_CLOSE, SLOT_MINUTES, nextOrderDay, dayLabel, clock, hhmm, DAY_NAMES, type Hours } from "./time";

/** Items one 15-minute pickup slot can take before it closes. */
const SLOT_CAPACITY = 16;
/** Orders allowed per guest connection in 15 minutes. */
const RATE_LIMIT = 4;
/** Orders at or above this total, or with this many items, alert the owner. */
const BIG_ORDER_PENCE = 6000, BIG_ORDER_ITEMS = 10;

type Status = "new" | "preparing" | "ready" | "collected" | "cancelled";
const FLOW: Status[] = ["new", "preparing", "ready", "collected"];

type OrderRow = {
  id: string; token: string; number: number; day: string; created: number;
  asap: number; slot_min: number; name: string; phone: string; email: string; notes: string;
  items: string; item_count: number; total: number; status: Status; updated: number;
  ready_at: number | null; collected_at: number | null; late_alerted: number;
};

export interface PlaceInput {
  name?: unknown; phone?: unknown; email?: unknown; notes?: unknown;
  when?: { asap?: boolean; day?: string; min?: number };
  lines?: CartLine[];
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const randomToken = (bytes = 18) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class Pass extends DurableObject<Env> {
  sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, number INTEGER NOT NULL, day TEXT NOT NULL,
        created INTEGER NOT NULL, asap INTEGER NOT NULL, slot_min INTEGER NOT NULL,
        name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, notes TEXT NOT NULL,
        items TEXT NOT NULL, item_count INTEGER NOT NULL, total INTEGER NOT NULL,
        status TEXT NOT NULL, updated INTEGER NOT NULL, ready_at INTEGER, collected_at INTEGER,
        late_alerted INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS orders_day ON orders(day, status);
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS soldout (item TEXT PRIMARY KEY, day TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, created INTEGER NOT NULL, payload TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rate (ip TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, created INTEGER NOT NULL);
    `);
    // Lets connected screens check the line is alive without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /* ---------- settings ---------- */
  private setting<T>(k: string, fallback: T): T {
    const r = this.sql.exec<{ v: string }>("SELECT v FROM settings WHERE k = ?", k).toArray()[0];
    return r ? (JSON.parse(r.v) as T) : fallback;
  }
  private save(k: string, v: unknown) { this.sql.exec("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v)); }
  private hours(): Hours { return this.setting<Hours>("hours", DEFAULT_HOURS); }
  private pause() { return this.setting<{ on: boolean; message: string }>("pause", { on: false, message: "" }); }
  private soldOut(): string[] {
    const today = london().date;
    return this.sql.exec<{ item: string }>("SELECT item FROM soldout WHERE day = ?", today).toArray().map((r) => r.item);
  }

  /* ---------- kitchen load, wait times and slots ---------- */
  private waitMinutes(): number {
    const now = london();
    const r = this.sql.exec<{ n: number }>(
      "SELECT COALESCE(SUM(item_count), 0) AS n FROM orders WHERE day = ? AND status IN ('new','preparing') AND slot_min <= ?",
      now.date, now.min + 20).toArray()[0];
    const raw = 10 + (r?.n ?? 0);
    return Math.min(45, Math.ceil(raw / 5) * 5);
  }
  private slotUse(day: string): Map<number, number> {
    const m = new Map<number, number>();
    for (const r of this.sql.exec<{ s: number; n: number }>(
      `SELECT (CAST(slot_min AS INTEGER) / ${SLOT_MINUTES}) * ${SLOT_MINUTES} AS s, SUM(item_count) AS n FROM orders WHERE day = ? AND status != 'cancelled' GROUP BY s`,
      day)) m.set(Number(r.s), Number(r.n));
    return m;
  }

  /** What the home page needs: open or closed, wait time, sold out dishes, hours. */
  status() {
    const hours = this.hours(), now = london(), pause = this.pause(), today = hours[String(now.dow)];
    const openNow = !!today && now.min >= today[0] && now.min < today[1];
    const asapOpen = openNow && now.min < today![1] - LAST_ORDER_BEFORE_CLOSE && !pause.on;
    const next = nextOrderDay(hours);
    let label: string;
    if (pause.on) label = pause.message || "We've paused online orders for a little while. Please check back soon.";
    else if (asapOpen) label = `Open now until ${clock(today![1])}`;
    else if (openNow) label = `Open until ${clock(today![1])}. Online orders have closed for today.`;
    else if (next) label = `Closed now. Opens ${dayLabel(next.offset, next.dow)} at ${clock(next.open)}.`;
    else label = "Closed for now.";
    return {
      openNow, asapOpen, paused: pause.on, label, waitMin: this.waitMinutes(),
      closesAt: openNow ? clock(today![1]) : null,
      orderDay: next ? { date: next.date, label: dayLabel(next.offset, next.dow) } : null,
      hours: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ dow: d, day: DAY_NAMES[d], hours: hours[String(d)] ? `${clock(hours[String(d)]![0])} to ${clock(hours[String(d)]![1])}` : "Closed", today: d === now.dow })),
      lastOrderNote: `Online orders close ${LAST_ORDER_BEFORE_CLOSE} minutes before we do.`,
    };
  }

  bootstrap() {
    return { menu: MENU, options: OPTIONS, soldOut: this.soldOut(), status: this.status() };
  }

  /** Pickup choices for checkout: ASAP when open, then 15-minute slots on the next order day. */
  slots() {
    const st = this.status(), hours = this.hours(), next = nextOrderDay(hours);
    if (st.paused || !next) return { paused: st.paused, message: st.label, asap: null, day: null, slots: [] };
    const now = london();
    const use = this.slotUse(next.date);
    let start = next.open + SLOT_MINUTES;
    if (next.offset === 0) start = Math.max(start, Math.ceil((now.min + 20) / SLOT_MINUTES) * SLOT_MINUTES);
    const slots = [];
    for (let m = start; m <= next.last; m += SLOT_MINUTES) {
      const left = SLOT_CAPACITY - (use.get(m) ?? 0);
      slots.push({ min: m, time: hhmm(m), label: clock(m), left: Math.max(0, left), full: left <= 0 });
    }
    return {
      paused: false, message: "",
      asap: st.asapOpen ? { waitMin: st.waitMin } : null,
      day: { date: next.date, label: dayLabel(next.offset, next.dow), offset: next.offset },
      slots,
    };
  }

  /* ---------- placing orders ---------- */
  async placeOrder(input: PlaceInput, ipHash: string): Promise<{ ok: true; token: string; number: number } | { ok: false; error: string; field?: string }> {
    const now = Date.now(), ln = london(now);
    const name = clean(input.name, 60), phone = clean(input.phone, 20), email = clean(input.email, 120).toLowerCase(), notes = clean(input.notes, 300);
    if (!name) return { ok: false, field: "name", error: "Please add your name so we know whose order it is." };
    if (!/^(\+44\s?|0)\d[\d\s]{8,12}$/.test(phone)) return { ok: false, field: "phone", error: "Please add a UK phone number, in case we need to reach you." };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, field: "email", error: "That email address doesn't look quite right." };

    const lines = Array.isArray(input.lines) ? input.lines.slice(0, 20) : [];
    if (!lines.length) return { ok: false, error: "Your order is empty. Add something from the menu first." };
    const sold = new Set(this.soldOut());
    const priced: PricedLine[] = [];
    for (const l of lines) {
      const p = priceLine(l);
      if (typeof p === "string") return { ok: false, error: p };
      if (sold.has(p.id)) return { ok: false, error: `Sorry, ${p.name} has just sold out. Please remove it and try again.` };
      priced.push(p);
    }
    const itemCount = priced.reduce((a, l) => a + l.qty, 0);
    if (itemCount > 30) return { ok: false, error: "For orders of more than 30 items, please call us so we can plan it with you." };
    const total = priced.reduce((a, l) => a + l.total, 0);

    // Pickup time
    const st = this.status();
    if (st.paused) return { ok: false, error: st.label };
    let day: string, slotMin: number, asap = 0;
    if (input.when?.asap) {
      if (!st.asapOpen) return { ok: false, field: "when", error: "We can't take orders for right now. Please choose a pickup time." };
      day = ln.date; slotMin = ln.min + st.waitMin; asap = 1;
    } else {
      const sl = this.slots();
      const pick = sl.slots.find((s) => s.min === Number(input.when?.min));
      if (!sl.day || input.when?.day !== sl.day.date || !pick) return { ok: false, field: "when", error: "Please choose a pickup time from the list." };
      if (pick.left < itemCount) return { ok: false, field: "when", error: `The ${pick.label} slot is nearly full. Please choose another time.` };
      day = sl.day.date; slotMin = pick.min;
    }

    // Light spam protection: a few orders per connection every 15 minutes.
    this.sql.exec("DELETE FROM rate WHERE ts < ?", now - 15 * 60_000);
    const recent = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM rate WHERE ip = ?", ipHash).toArray()[0]?.n ?? 0;
    if (recent >= RATE_LIMIT) return { ok: false, error: "You've placed a few orders in a short time. Please wait a few minutes, or give us a call." };
    this.sql.exec("INSERT INTO rate (ip, ts) VALUES (?, ?)", ipHash, now);

    const number = (this.sql.exec<{ n: number }>("SELECT COALESCE(MAX(number), 0) AS n FROM orders WHERE day = ?", day).toArray()[0]?.n ?? 0) + 1;
    const id = crypto.randomUUID(), token = randomToken();
    this.sql.exec(
      `INSERT INTO orders (id, token, number, day, created, asap, slot_min, name, phone, email, notes, items, item_count, total, status, updated, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      id, token, number, day, now, asap, slotMin, name, phone, email, notes, JSON.stringify(priced), itemCount, total, now, ipHash);
    const o = this.row(id)!;

    if (email) this.enqueue("order_placed", this.mailPayload(o));
    if (total >= BIG_ORDER_PENCE || itemCount >= BIG_ORDER_ITEMS) this.enqueue("big_order", this.alertPayload(o));
    this.broadcast(o);
    return { ok: true, token, number };
  }

  /* ---------- mailing list ---------- */
  subscribe(rawEmail: unknown, ipHash: string): { ok: boolean; error?: string } {
    const email = clean(rawEmail, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: "That email address doesn't look quite right." };
    const now = Date.now(), key = `nl:${ipHash}`;
    this.sql.exec("DELETE FROM rate WHERE ts < ?", now - 15 * 60_000);
    if ((this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM rate WHERE ip = ?", key).toArray()[0]?.n ?? 0) >= 5) return { ok: false, error: "Please try again in a few minutes." };
    this.sql.exec("INSERT INTO rate (ip, ts) VALUES (?, ?)", key, now);
    const isNew = !this.sql.exec("SELECT 1 FROM newsletter WHERE email = ?", email).toArray().length;
    if (isNew) {
      this.sql.exec("INSERT INTO newsletter (email, created) VALUES (?, ?)", email, now);
      this.enqueue("newsletter_signup", { email, created: now });
    }
    return { ok: true };
  }

  /* ---------- views ---------- */
  private row(id: string) { return this.sql.exec<OrderRow>("SELECT * FROM orders WHERE id = ?", id).toArray()[0] as OrderRow | undefined; }
  private byToken(token: string) { return this.sql.exec<OrderRow>("SELECT * FROM orders WHERE token = ?", token).toArray()[0] as OrderRow | undefined; }

  private pickupLabel(o: OrderRow) {
    const today = london().date;
    if (o.asap) return `As soon as possible, around ${clock(o.slot_min)}`;
    const when = o.day === today ? "Today" : o.day === london(Date.now() + 86_400_000).date ? "Tomorrow" : new Date(o.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return `${when} at ${clock(o.slot_min)}`;
  }
  private ahead(o: OrderRow) {
    if (o.status !== "new" && o.status !== "preparing") return 0;
    return this.sql.exec<{ n: number }>(
      "SELECT COUNT(*) AS n FROM orders WHERE day = ? AND status IN ('new','preparing') AND slot_min < ? AND id != ?", o.day, o.slot_min, o.id).toArray()[0]?.n ?? 0;
  }

  /** What a guest may see about their own order. No phone number, no other guests. */
  private guestView(o: OrderRow) {
    return {
      number: o.number, firstName: o.name.split(/\s+/)[0], status: o.status, total: o.total,
      items: (JSON.parse(o.items) as PricedLine[]).map((l) => ({ name: l.name, qty: l.qty, options: l.options, total: l.total })),
      notes: o.notes, pickup: this.pickupLabel(o), asap: !!o.asap, day: o.day, slotMin: o.slot_min,
      created: o.created, readyAt: o.ready_at, ahead: this.ahead(o), hasEmail: !!o.email,
    };
  }
  /** What the kitchen sees. */
  private kitchenView(o: OrderRow) {
    return {
      id: o.id, number: o.number, name: o.name, status: o.status, created: o.created, updated: o.updated,
      asap: !!o.asap, slotMin: o.slot_min, slotLabel: clock(o.slot_min), notes: o.notes, total: o.total,
      items: (JSON.parse(o.items) as PricedLine[]).map((l) => ({ name: l.name, qty: l.qty, options: l.options })),
      readyAt: o.ready_at, collectedAt: o.collected_at,
    };
  }

  getOrder(token: string) { const o = this.byToken(token); return o ? this.guestView(o) : null; }

  kitchenSnapshot() {
    const today = london().date;
    const active = this.sql.exec<OrderRow>("SELECT * FROM orders WHERE day = ? AND status IN ('new','preparing','ready') ORDER BY slot_min, created", today).toArray() as OrderRow[];
    const recall = this.sql.exec<OrderRow>("SELECT * FROM orders WHERE day = ? AND status = 'collected' ORDER BY collected_at DESC LIMIT 10", today).toArray() as OrderRow[];
    return { type: "snapshot", now: Date.now(), today, orders: active.map((o) => this.kitchenView(o)), recall: recall.map((o) => this.kitchenView(o)), soldOut: this.soldOut(), paused: this.pause().on };
  }

  /* ---------- kitchen actions ---------- */
  setStatus(id: string, to: Status): { ok: boolean; error?: string } {
    const o = this.row(id);
    if (!o) return { ok: false, error: "That order no longer exists." };
    if (o.status === to) return { ok: true };
    const from = FLOW.indexOf(o.status), target = FLOW.indexOf(to);
    if (to !== "cancelled" && (target < 0 || Math.abs(target - from) !== 1)) return { ok: false, error: "That step isn't possible for this order." };
    const now = Date.now();
    this.sql.exec("UPDATE orders SET status = ?, updated = ?, ready_at = CASE WHEN ? = 'ready' THEN ? ELSE ready_at END, collected_at = CASE WHEN ? = 'collected' THEN ? WHEN ? != 'collected' THEN NULL ELSE collected_at END WHERE id = ?",
      to, now, to, now, to, now, to, id);
    const n = this.row(id)!;
    if (to === "ready" && o.status === "preparing" && n.email && !this.sql.exec("SELECT 1 FROM outbox WHERE type = 'order_ready' AND payload LIKE ?", `%"id":"${id}"%`).toArray().length) {
      this.enqueue("order_ready", this.mailPayload(n));
    }
    this.broadcast(n);
    return { ok: true };
  }

  /* ---------- owner actions ---------- */
  setPause(on: boolean, message: string) { this.save("pause", { on: !!on, message: clean(message, 200) }); this.pushKitchen(); return this.status(); }
  setSoldOut(item: string, sold: boolean) {
    if (!findItem(item)) return { ok: false };
    if (sold) this.sql.exec("INSERT INTO soldout (item, day) VALUES (?, ?) ON CONFLICT(item) DO UPDATE SET day = excluded.day", item, london().date);
    else this.sql.exec("DELETE FROM soldout WHERE item = ?", item);
    this.pushKitchen();
    return { ok: true, soldOut: this.soldOut() };
  }
  setHours(input: Record<string, unknown>) {
    const h: Hours = {};
    for (let d = 0; d < 7; d++) {
      const v = input[String(d)];
      if (Array.isArray(v) && v.length === 2) {
        const a = Math.round(Number(v[0])), b = Math.round(Number(v[1]));
        if (!(a >= 300 && b <= 1380 && b - a >= 60)) return { ok: false, error: `Please check the hours for ${DAY_NAMES[d]}. Closing must be at least an hour after opening.` };
        h[String(d)] = [a, b];
      } else h[String(d)] = null;
    }
    this.save("hours", h);
    return { ok: true, status: this.status() };
  }
  ownerSettings() {
    return { hours: this.hours(), pause: this.pause(), soldOut: this.soldOut(), menu: MENU.map((s) => ({ name: s.name, items: s.items.map((i) => ({ id: i.id, name: i.name })) })) };
  }

  /** Today's (or any day's) orders, takings and best sellers. */
  report(day = london().date) {
    const rows = this.sql.exec<OrderRow>("SELECT * FROM orders WHERE day = ? ORDER BY slot_min, created", day).toArray() as OrderRow[];
    const live = rows.filter((o) => o.status !== "cancelled");
    const counts: Record<string, number> = {};
    for (const o of live) for (const l of JSON.parse(o.items) as PricedLine[]) counts[l.name] = (counts[l.name] ?? 0) + l.qty;
    return {
      day, orders: live.length, cancelled: rows.length - live.length,
      takings: live.filter((o) => o.status === "collected").reduce((a, o) => a + o.total, 0),
      expected: live.reduce((a, o) => a + o.total, 0),
      items: live.reduce((a, o) => a + o.item_count, 0),
      notCollected: live.filter((o) => o.status === "ready").length,
      bestSellers: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
      list: rows.map((o) => ({ id: o.id, number: o.number, name: o.name, pickup: o.asap ? `ASAP, ${clock(o.slot_min)}` : clock(o.slot_min), total: o.total, status: o.status, items: o.item_count })),
    };
  }

  /* ---------- outbox for n8n ---------- */
  private enqueue(type: string, payload: unknown) { this.sql.exec("INSERT INTO outbox (type, created, payload) VALUES (?, ?, ?)", type, Date.now(), JSON.stringify(payload)); }
  private statusUrl(o: OrderRow) { return `${this.env.SITE_URL}/order/${o.token}`; }
  private mailPayload(o: OrderRow) {
    return { id: o.id, number: o.number, name: o.name, email: o.email, pickup: this.pickupLabel(o), total: o.total, items: (JSON.parse(o.items) as PricedLine[]).map((l) => ({ name: l.name, qty: l.qty, options: l.options, total: l.total })), notes: o.notes, statusUrl: this.statusUrl(o) };
  }
  private alertPayload(o: OrderRow) {
    return { id: o.id, number: o.number, name: o.name, pickup: this.pickupLabel(o), total: o.total, items: o.item_count, status: o.status, waitingMin: Math.round((Date.now() - o.created) / 60_000) };
  }
  /** Unsent messages for n8n. Also flags orders that have waited too long. */
  outbox(limit = 50) {
    const now = london();
    const late = this.sql.exec<OrderRow>(
      `SELECT * FROM orders WHERE day = ? AND late_alerted = 0 AND status IN ('new','preparing')
       AND ((asap = 1 AND created < ?) OR (asap = 0 AND slot_min + 5 < ?))`, now.date, Date.now() - 20 * 60_000, now.min).toArray() as OrderRow[];
    for (const o of late) { this.enqueue("order_late", this.alertPayload(o)); this.sql.exec("UPDATE orders SET late_alerted = 1 WHERE id = ?", o.id); }
    return this.sql.exec<{ id: number; type: string; created: number; payload: string }>("SELECT id, type, created, payload FROM outbox WHERE sent = 0 ORDER BY id LIMIT ?", limit)
      .toArray().map((r) => ({ id: r.id, type: r.type, created: r.created, data: JSON.parse(r.payload) }));
  }
  ack(ids: number[]) {
    const clean = ids.map(Number).filter((n) => Number.isInteger(n)).slice(0, 200);
    for (const id of clean) this.sql.exec("UPDATE outbox SET sent = ? WHERE id = ?", Date.now(), id);
    this.sql.exec("DELETE FROM outbox WHERE sent > 0 AND sent < ?", Date.now() - 7 * 86_400_000);
    return { ok: true, acked: clean.length };
  }

  /* ---------- live connections ---------- */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    if (url.pathname === "/ws/kitchen") {
      this.ctx.acceptWebSocket(server, ["kitchen"]);
      server.send(JSON.stringify(this.kitchenSnapshot()));
    } else {
      const token = url.pathname.split("/")[3] ?? "";
      const o = this.byToken(token);
      if (!o) { server.accept(); server.close(4404, "Order not found"); return new Response(null, { status: 101, webSocket: client }); }
      this.ctx.acceptWebSocket(server, [`o:${token}`]);
      server.send(JSON.stringify({ type: "order", order: this.guestView(o) }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (msg === "snapshot" && this.ctx.getTags(ws).includes("kitchen")) ws.send(JSON.stringify(this.kitchenSnapshot()));
  }
  async webSocketClose(ws: WebSocket, code: number) { try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch { /* already closed */ } }

  private send(tag: string, data: unknown) {
    const msg = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets(tag)) { try { ws.send(msg); } catch { /* closed socket */ } }
  }
  private broadcast(o: OrderRow) {
    if (o.day === london().date) this.send("kitchen", { type: "order", order: this.kitchenView(o) });
    this.send(`o:${o.token}`, { type: "order", order: this.guestView(o) });
    // Other guests' queue positions may have moved. Refresh them cheaply.
    if (o.status === "ready" || o.status === "collected" || o.status === "cancelled") {
      for (const r of this.sql.exec<OrderRow>("SELECT * FROM orders WHERE day = ? AND status IN ('new','preparing')", o.day).toArray() as OrderRow[]) {
        if (this.ctx.getWebSockets(`o:${r.token}`).length) this.send(`o:${r.token}`, { type: "order", order: this.guestView(r) });
      }
    }
  }
  private pushKitchen() { this.send("kitchen", this.kitchenSnapshot()); }
}
