import { Pass } from "./pass";
export { Pass };

type Role = "staff" | "owner";
const COOKIE = "ff_session";
const SESSION_HOURS = 14;

const json = (data: unknown, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const err = (message: string, status = 400, field?: string) => json({ ok: false, error: message, field }, status);

function pass(env: Env) {
  return env.PASS.get(env.PASS.idFromName("fieldfare"), { locationHint: "weur" });
}

/* ---------- signed login cookie ---------- */
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeSession(env: Env, role: Role) {
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const body = `${role}.${exp}`;
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}
async function sessionRole(req: Request, env: Env): Promise<Role | null> {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw || !env.SESSION_SECRET) return null;
  const [role, exp, sig] = raw.split(".");
  if (!role || !exp || !sig || Number(exp) < Date.now()) return null;
  if (!safeEqual(sig, await hmac(env.SESSION_SECRET, `${role}.${exp}`))) return null;
  return role === "owner" || role === "staff" ? role : null;
}
const cookieHeader = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

async function ipHash(req: Request, env: Env) {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  return (await hmac(env.SESSION_SECRET || "fieldfare", `ip:${ip}`)).slice(0, 16);
}
async function body<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
/** Blocks form posts from other websites. */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;

    // Each guest's order page is the same HTML; the token in the address picks the order.
    if (p.startsWith("/order/")) return env.ASSETS.fetch(new Request(new URL("/order", url), req));

    // Live connections
    if (p === "/ws/kitchen") {
      const role = await sessionRole(req, env);
      if (!role) return new Response("Please sign in", { status: 401 });
      return pass(env).fetch(req);
    }
    if (/^\/ws\/order\/[\w-]{10,40}$/.test(p)) return pass(env).fetch(req);

    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (m !== "GET" && !sameOrigin(req)) return err("This request came from another site.", 403);

    /* ----- public ----- */
    if (p === "/api/bootstrap" && m === "GET") return json(await pass(env).bootstrap());
    if (p === "/api/slots" && m === "GET") return json(await pass(env).slots());
    if (p === "/api/orders" && m === "POST") {
      const input = await body<Record<string, unknown>>(req);
      if (!input) return err("We couldn't read your order. Please try again.");
      const r = await pass(env).placeOrder(input as never, await ipHash(req, env));
      return r.ok ? json(r, 201) : err(r.error, r.error.startsWith("You've placed") ? 429 : 400, r.field);
    }
    if (p === "/api/newsletter" && m === "POST") {
      const b = await body<{ email?: string }>(req);
      const r = await pass(env).subscribe(b?.email, await ipHash(req, env));
      return r.ok ? json(r) : err(r.error!);
    }
    const orderMatch = p.match(/^\/api\/orders\/([\w-]{10,40})$/);
    if (orderMatch && m === "GET") {
      const o = await pass(env).getOrder(orderMatch[1]);
      return o ? json({ ok: true, order: o }) : err("We couldn't find that order.", 404);
    }

    /* ----- sign in and out ----- */
    if (p === "/api/login" && m === "POST") {
      const b = await body<{ password?: string; role?: Role }>(req);
      const role: Role = b?.role === "owner" ? "owner" : "staff";
      const expected = role === "owner" ? env.OWNER_PASSWORD : env.STAFF_PASSWORD;
      if (!expected || !env.SESSION_SECRET) return err("Sign-in isn't set up yet.", 503);
      // Owners can also use the kitchen screen.
      const ok = typeof b?.password === "string" && (safeEqual(b.password, expected) || (role === "staff" && !!env.OWNER_PASSWORD && safeEqual(b.password, env.OWNER_PASSWORD)));
      if (!ok) { await new Promise((r) => setTimeout(r, 600)); return err("That password isn't right. Please try again.", 401); }
      const signedRole: Role = role === "staff" && env.OWNER_PASSWORD && safeEqual(b!.password!, env.OWNER_PASSWORD) ? "owner" : role;
      return json({ ok: true, role: signedRole }, 200, { "set-cookie": cookieHeader(await makeSession(env, signedRole), SESSION_HOURS * 3600) });
    }
    if (p === "/api/logout" && m === "POST") return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
    if (p === "/api/me" && m === "GET") return json({ role: await sessionRole(req, env) });

    /* ----- kitchen (staff or owner) ----- */
    if (p.startsWith("/api/kitchen/")) {
      if (!(await sessionRole(req, env))) return err("Please sign in again.", 401);
      const st = p.match(/^\/api\/kitchen\/orders\/([\w-]{36})$/);
      if (st && m === "POST") {
        const b = await body<{ status?: string }>(req);
        const to = String(b?.status ?? "");
        if (!["new", "preparing", "ready", "collected"].includes(to)) return err("Unknown step.");
        const r = await pass(env).setStatus(st[1], to as never);
        return r.ok ? json(r) : err(r.error ?? "Couldn't update the order.", 409);
      }
      if (p === "/api/kitchen/snapshot" && m === "GET") return json(await pass(env).kitchenSnapshot());
      if (p === "/api/kitchen/soldout" && m === "POST") {
        const b = await body<{ item?: string; sold?: boolean }>(req);
        return json(await pass(env).setSoldOut(String(b?.item ?? ""), !!b?.sold));
      }
      return err("Not found", 404);
    }

    /* ----- owner ----- */
    if (p.startsWith("/api/owner/")) {
      if ((await sessionRole(req, env)) !== "owner") return err("Please sign in with the owner password.", 401);
      const P = pass(env);
      if (p === "/api/owner/settings" && m === "GET") return json(await P.ownerSettings());
      if (p === "/api/owner/report" && m === "GET") return json(await P.report(url.searchParams.get("day") ?? undefined));
      if (p === "/api/owner/pause" && m === "POST") { const b = await body<{ on?: boolean; message?: string }>(req); return json(await P.setPause(!!b?.on, String(b?.message ?? ""))); }
      if (p === "/api/owner/soldout" && m === "POST") { const b = await body<{ item?: string; sold?: boolean }>(req); return json(await P.setSoldOut(String(b?.item ?? ""), !!b?.sold)); }
      if (p === "/api/owner/hours" && m === "POST") { const b = await body<Record<string, unknown>>(req); const r = await P.setHours(b ?? {}); return r.ok ? json(r) : err(r.error!); }
      const cancel = p.match(/^\/api\/owner\/orders\/([\w-]{36})\/cancel$/);
      if (cancel && m === "POST") return json(await P.setStatus(cancel[1], "cancelled"));
      return err("Not found", 404);
    }

    /* ----- n8n outbox (token protected) ----- */
    if (p.startsWith("/api/outbox") || p === "/api/summary") {
      const auth = req.headers.get("authorization") ?? "";
      if (!env.OUTBOX_TOKEN || !safeEqual(auth, `Bearer ${env.OUTBOX_TOKEN}`)) return err("Not allowed", 401);
      if (p === "/api/outbox" && m === "GET") return json({ events: await pass(env).outbox() });
      if (p === "/api/outbox/ack" && m === "POST") { const b = await body<{ ids?: number[] }>(req); return json(await pass(env).ack(Array.isArray(b?.ids) ? b!.ids! : [])); }
      if (p === "/api/summary" && m === "GET") { const d = url.searchParams.get("day"); return json(await pass(env).summary(d && /^d{4}-d{2}-d{2}$/.test(d) ? d : undefined)); }
    }

    return err("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
