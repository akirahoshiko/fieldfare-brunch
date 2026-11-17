// Wording for everything n8n sends. Kept here so emails, Telegram alerts and sheet
// rows are written in one place and n8n only has to deliver them.

export interface MailLine { name: string; qty: number; options: string[]; total: number }
export interface MailOrder { id: string; number: number; name: string; email: string; phone?: string; pickup: string; total: number; items: MailLine[]; notes: string; statusUrl: string }
export interface AlertOrder { id: string; number: number; name: string; pickup: string; total: number; items: number; status: string; waitingMin: number }

export interface Action {
  id: number; type: string;
  email: { to: string; subject: string; html: string } | null;
  telegram: string | null;
  sheet: { tab: string; row: Record<string, string | number> } | null;
}

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
const pad = (n: number) => String(n).padStart(3, "0");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const first = (name: string) => name.trim().split(/\s+/)[0];

function layout(title: string, intro: string, body: string, button?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F7F3EC;font-family:Helvetica,Arial,sans-serif;color:#1E2621">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F3EC;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#16301F;padding:20px 28px;font-family:Georgia,serif;font-size:24px;color:#F7F3EC">Fieldfare</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 8px;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.2">${title}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5D6862">${intro}</p>
${body}
${button ? `<p style="margin:24px 0 0"><a href="${button.href}" style="display:inline-block;background:#D9B45C;color:#16301F;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:99px;font-size:15px">${button.label}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #E4DFD5;font-size:12.5px;line-height:1.5;color:#5D6862">Fieldfare · Church Street, Stoke Newington, London N16<br>You're getting this because you ordered on our website.</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(o: MailOrder) {
  const rows = o.items.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #EEE9DF;font-size:15px">${l.qty} × ${esc(l.name)}${l.options.length ? `<br><span style="font-size:13px;color:#5D6862">${esc(l.options.join(", "))}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #EEE9DF;font-size:15px;white-space:nowrap">${gbp(l.total)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
<tr><td style="padding:12px 0 0;font-size:15px">Pay at the counter</td><td align="right" style="padding:12px 0 0;font-size:17px;font-weight:bold">${gbp(o.total)}</td></tr></table>`;
}

export function placedEmail(o: MailOrder) {
  return {
    to: o.email,
    subject: `Order ${pad(o.number)} is in. Pickup ${o.pickup.replace(/^As soon as possible, around/, "around")}`,
    html: layout(`Thanks, ${esc(first(o.name))}. We've got your order.`,
      `Your order number is <b>${pad(o.number)}</b>. Pickup: <b>${esc(o.pickup)}</b>. Give your name at the counter and pay when you collect.`,
      itemsTable(o) + (o.notes ? `<p style="margin:16px 0 0;font-size:14px;color:#5D6862">Your note: ${esc(o.notes)}</p>` : ""),
      { href: o.statusUrl, label: "Follow your order" }),
  };
}

export function readyEmail(o: MailOrder) {
  return {
    to: o.email,
    subject: `Your order ${pad(o.number)} is ready`,
    html: layout(`Your order is ready, ${esc(first(o.name))}`,
      `Order <b>${pad(o.number)}</b> is waiting for you at the counter on Church Street. Give your name and pay when you collect: <b>${gbp(o.total)}</b>.`,
      "", { href: o.statusUrl, label: "See your order" }),
  };
}

export function bigOrderText(o: AlertOrder) {
  return `Big order coming in\nOrder ${pad(o.number)} for ${o.name}\n${o.items} items, ${gbp(o.total)}\nPickup: ${o.pickup}`;
}
export function lateOrderText(o: AlertOrder) {
  const where = o.status === "new" ? "not started yet" : "still cooking";
  return `Order waiting too long\nOrder ${pad(o.number)} for ${o.name} is ${where}.\nPlaced ${o.waitingMin} min ago. Pickup: ${o.pickup}`;
}

export function orderRow(o: MailOrder, placedAt: number) {
  return {
    tab: "Orders",
    row: {
      placed_at: new Date(placedAt).toLocaleString("en-GB", { timeZone: "Europe/London" }),
      order: pad(o.number), pickup: o.pickup, name: o.name, phone: o.phone ?? "", email: o.email,
      items: o.items.map((l) => `${l.qty} x ${l.name}${l.options.length ? ` (${l.options.join(", ")})` : ""}`).join("; "),
      total_gbp: (o.total / 100).toFixed(2), notes: o.notes,
    },
  };
}
export function mailingRow(email: string, at: number) {
  return { tab: "Mailing list", row: { signed_up: new Date(at).toLocaleString("en-GB", { timeZone: "Europe/London" }), email } };
}

export interface Report { day: string; orders: number; cancelled: number; takings: number; expected: number; items: number; notCollected: number; bestSellers: { name: string; qty: number }[] }
export function summaryText(r: Report, open: boolean) {
  const date = new Date(r.day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  if (!r.orders && !r.cancelled) return open ? `Fieldfare, ${date}\nNo online orders today.` : null;
  const best = r.bestSellers.slice(0, 3).map((b, i) => `${i + 1}. ${b.name} (${b.qty})`).join("\n");
  return `Fieldfare, ${date}\n${r.orders} online order${r.orders === 1 ? "" : "s"}, ${r.items} items\nTaken at the counter: ${gbp(r.takings)}\nExpected: ${gbp(r.expected)}` +
    (r.notCollected ? `\nNot collected: ${r.notCollected}` : "") + (r.cancelled ? `\nCancelled: ${r.cancelled}` : "") +
    (best ? `\n\nBest sellers\n${best}` : "");
}
export function summaryRow(r: Report) {
  return {
    tab: "Daily summary",
    row: { day: r.day, orders: r.orders, items: r.items, takings_gbp: (r.takings / 100).toFixed(2), expected_gbp: (r.expected / 100).toFixed(2), not_collected: r.notCollected, cancelled: r.cancelled, best_sellers: r.bestSellers.map((b) => `${b.name} (${b.qty})`).join(", ") },
  };
}
