/**
 * Business time for marketing inputs. Tunisia does not observe daylight saving time, so its offset is a fixed
 * UTC+1. Values from <input type="datetime-local"> are local wall-clock times without a zone.
 *
 * Never call Date or toISOString on user text directly: an invalid date throws a RangeError, which surfaces to the
 * user as a crash. These helpers validate first and return a message the form can show.
 */
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const TUNISIA_OFFSET_HOURS = 1;

export type LocalDateTimeResult = { ok: true; iso: string } | { ok: false; message: string };

/** Converts a datetime-local value (Tunisia time) to an ISO instant. Empty input returns an empty ISO string. */
export function tunisiaLocalToIso(value: string): LocalDateTimeResult {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, iso: "" };
  const match = DATETIME_LOCAL.exec(trimmed);
  if (!match) return { ok: false, message: "Enter a complete date and time." };
  const [year, month, day, hour, minute, second] = [match[1], match[2], match[3], match[4], match[5], match[6] ?? "0"].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, message: "That date or time does not exist." };
  }
  const utc = new Date(Date.UTC(year, month - 1, day, hour - TUNISIA_OFFSET_HOURS, minute, second));
  // Rejects dates that roll over, such as 31 February.
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return { ok: false, message: "That date does not exist." };
  }
  return { ok: true, iso: utc.toISOString() };
}

/** Parses an ISO instant. Returns null when the input is not a real date. Never throws. */
export function parseIsoInstant(value: string): Date | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?Z$/;

/**
 * Strict UTC instant (as produced by toISOString). `Date.parse` rolls invalid dates over, so the value is
 * accepted only if it survives a round trip unchanged. Returns null for anything else.
 */
export function parseStrictInstant(value: string): Date | null {
  if (!UTC_INSTANT.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 16) === value.slice(0, 16) ? parsed : null;
}
