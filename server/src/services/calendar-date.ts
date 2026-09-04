const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Format an instant as the calendar date observed in the server's local timezone. */
export function localDateKey(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Format an instant as the compact local calendar date used by NewLore report paths. */
export function localCompactDate(date: Date = new Date()): string {
  return localDateKey(date).replaceAll("-", "");
}

/** Validate a canonical YYYY-MM-DD calendar date without applying a timezone conversion. */
export function isDateKey(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Convert a date-like input into a calendar key, preserving explicit date strings. */
export function dateKey(value: string | Date): string {
  if (typeof value === "string") {
    if (!isDateKey(value)) throw new Error(`Invalid calendar date: ${value}`);
    return value;
  }
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid calendar date");
  return localDateKey(value);
}

/** Shift a canonical calendar key by whole days without daylight-saving drift. */
export function shiftDateKey(value: string, days: number): string {
  if (!isDateKey(value)) throw new Error(`Invalid calendar date: ${value}`);
  const shifted = new Date(`${value}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
