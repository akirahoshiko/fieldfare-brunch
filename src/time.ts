// Everything the guest sees is in London time, whatever time zone the server runs in.

export interface LondonNow { date: string; min: number; dow: number }
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});

export function london(ts = Date.now()): LondonNow {
  const p: Record<string, string> = {};
  for (const part of FMT.formatToParts(new Date(ts))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), dow: DOW[p.weekday] ?? 0 };
}

/** Opening hours per weekday (0 = Sunday): [open, close] in minutes after midnight, or null when closed. */
export type Hours = Record<string, [number, number] | null>;
export const DEFAULT_HOURS: Hours = { "0": [480, 900], "1": null, "2": null, "3": [480, 900], "4": [480, 900], "5": [480, 900], "6": [480, 900] };
export const LAST_ORDER_BEFORE_CLOSE = 30;
export const SLOT_MINUTES = 15;

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function clock(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const h12 = ((h + 11) % 12) + 1, ap = h < 12 ? "am" : "pm";
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** The next day (today or later, within a week) when online orders are still possible. */
export function nextOrderDay(hours: Hours, ts = Date.now()) {
  for (let k = 0; k < 8; k++) {
    const d = london(ts + k * 86_400_000);
    const h = hours[String(d.dow)];
    if (!h) continue;
    const last = h[1] - LAST_ORDER_BEFORE_CLOSE;
    if (k === 0 && london(ts).min >= last) continue;
    return { offset: k, date: d.date, dow: d.dow, open: h[0], close: h[1], last };
  }
  return null;
}

export function dayLabel(offset: number, dow: number) {
  return offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_NAMES[dow];
}
