# Fieldfare

Online ordering for Fieldfare, a small brunch kitchen on Church Street, Stoke Newington. Guests order for pickup and pay at the counter. Orders appear instantly on a kitchen screen, staff move them through the steps, and each guest's order page updates live.

A self-initiated project by Peace Ejiga.

## What's in it

| Page | Who it's for | What it does |
|---|---|---|
| `/` | Guests | Menu in five sections, dish options and allergens, order panel, checkout with live pickup times |
| `/order/<link>` | The guest who ordered | Live status (received, being prepared, ready), their items and total, their ticket as the kitchen sees it |
| `/kitchen` | Staff, password protected | New, In progress and Ready columns, sound for new orders, timers that change colour, "all day" counts, tick-off items, undo and recall, sold-out switches |
| `/owner` | Owner, password protected | Today's orders and takings, best sellers, pause online orders, sold-out dishes, opening hours, cancel an order |

## How it works

- **Cloudflare Workers.** One Worker serves the static pages and the API. No framework, so pages load in one round trip.
- **One Durable Object, "the pass".** It stores today's orders in its built-in SQLite database and keeps a WebSocket open to every kitchen screen and guest order page. Every change is pushed straight away. Connections use hibernation, so idle screens cost nothing.
- **Fallbacks.** If a guest's connection drops, their page checks every 10 seconds and reconnects. If the kitchen tablet loses Wi-Fi, taps are saved on the tablet and sent in order when it reconnects.
- **Prices are worked out on the server** from `src/menu.ts`, never trusted from the browser.
- **Pickup slots** are 15 minutes long and close when the kitchen has 16 items booked in them. The ASAP wait time grows with the queue.
- **Times are London time**, wherever the server runs.
- **Privacy.** A guest's page never shows their phone number or anyone else's order. Order links are long random tokens.
- **Spam protection.** Four orders per connection every 15 minutes, posts from other websites are refused, and orders are limited to 30 items.

```
src/
  worker.ts   routes, sign-in cookie, outbox token
  pass.ts     the Durable Object: orders, slots, settings, live connections, outbox
  menu.ts     dishes, options, prices, allergens
  time.ts     London time, opening hours, slot helpers
public/       pages, styles, scripts and photos
```

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit the values
npm run dev                       # http://localhost:8787
npm run check                     # TypeScript
```

## Secrets

Set these in Cloudflare (Workers & Pages > fieldfare-brunch > Settings > Variables and secrets), or with `npx wrangler secret put NAME`. Never commit them.

| Name | Used for |
|---|---|
| `STAFF_PASSWORD` | Kitchen screen sign-in |
| `OWNER_PASSWORD` | Owner page sign-in (also opens the kitchen screen) |
| `SESSION_SECRET` | Signs the sign-in cookie. Any long random string |
| `OUTBOX_TOKEN` | Lets n8n read the outbox. Any long random string |

## Deploy

```bash
npx wrangler deploy
```

## n8n automations

n8n runs on a local PC and collects work from the site, so no tunnel or webhook is needed. The site never waits for n8n: if the PC is off, messages queue and go out when it's back. The site writes every email, Telegram message and sheet row itself (`src/messages.ts`); n8n only delivers them.

| Workflow | When | What it does |
|---|---|---|
| Order messages | Every minute | Confirmation email, "your order is ready" email, Telegram alerts for big orders (£60 or 10 items) and orders waiting too long, and rows in the Orders and Mailing list tabs. An event is marked done only after every step works, so a failed step is retried next minute |
| End-of-day summary | Daily at 3:30pm London | Telegram summary (orders, takings, best sellers) and a row in the Daily summary tab. Quiet on closed days with no orders |
| Error alerts | When a workflow fails | Telegram message naming the workflow and the step |
| One-time sheet setup | Once, by hand | Creates the "Fieldfare" Google Sheet with its three tabs and header rows |

API used by n8n, with the header `Authorization: Bearer <OUTBOX_TOKEN>`:

- `GET /api/outbox` returns up to 50 events. Each has `email` (to, subject, html), `telegram` (text) and `sheet` (tab, row); any of them can be empty.
- `POST /api/outbox/ack` with `{ "ids": [1, 2] }` marks events as sent.
- `GET /api/summary?day=YYYY-MM-DD` returns the day's report with ready-made `telegram` text and `sheet` row.

Setup:

1. In n8n, create a Header Auth credential named "Fieldfare API" (name `Authorization`, value `Bearer <OUTBOX_TOKEN>`), plus Gmail, Google Sheets and Telegram credentials.
2. Run `node automation/build-workflows.mjs`, import the four `automation/fieldfare-*.json` files, and choose your credentials in each node.
3. Run "One-time sheet setup", then put the new sheet's id and your Telegram chat id into the two main workflows (or into `automation/local.json` and rebuild).
4. Publish "Order messages", "End-of-day summary" and "Error alerts".

## Photos

Photos are from [Unsplash](https://unsplash.com) under the Unsplash License. See `CREDITS.md`.
