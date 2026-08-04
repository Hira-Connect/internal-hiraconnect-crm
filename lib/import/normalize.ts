/** Turning whatever Excel produced into a clean string, or saying why it cannot be.
 *
 *  Everything here is pure so it can be unit-tested without a workbook, and it is
 *  the only place that knows about Excel's quirks: serial dates, rich text,
 *  cached formula results, hyperlink objects and non-breaking spaces.
 */

/** The subset of exceljs cell values we can meet. Kept structural so this module
 *  does not have to import exceljs, and therefore stays client-safe. */
export type RawCell =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | { text?: unknown; hyperlink?: unknown }
  | { richText?: { text?: unknown }[] }
  | { formula?: unknown; result?: unknown; sharedFormula?: unknown }
  | { error?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A cell that tries to be a formula rather than data.
 *
 *  Two concerns collapse into one rule. A live formula's *text* must never be
 *  treated as a value — we read the cached result instead — and a plain text cell
 *  starting with `=`, `@`, `+cmd` or `-cmd` is the classic spreadsheet-injection
 *  payload: inert in this database, dangerous the moment somebody opens an export
 *  of it in Excel. Refusing it at the door beats sanitising every export forever.
 *
 *  `+91 98…` and `-500` stay legal: a digit after the sign is data, not a call. */
export function looksLikeFormula(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^[=@]/.test(trimmed)) return true;
  // +SUM(…) or -cmd|… — a sign followed by something that is not a number
  return /^[+-](?![\d\s.,])/.test(trimmed);
}

/** Strips control and zero-width characters, collapses runs of whitespace, trims.
 *  `\p{C}` covers C0/C1 controls plus the invisible format characters (zero-width
 *  space, BOM) that make two "identical" company names fail to match; `\s` then
 *  mops up the non-breaking spaces Excel leaves in pasted data.
 *
 *  Line breaks become spaces on purpose: a multi-line paste must not smuggle a
 *  newline into a single-line field. */
export function sanitizeText(value: string): string {
  return value
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CellRead {
  /** Sanitized text, or "" when the cell is empty. */
  text: string;
  /** Set when the cell could not be read safely — the row is rejected with this. */
  problem: string | null;
  /** The underlying JS Date, when Excel gave us a real date cell. */
  date: Date | null;
  /** The underlying number, when Excel gave us a real numeric cell. */
  number: number | null;
}

const EMPTY: CellRead = { text: "", problem: null, date: null, number: null };

/** Reads one cell into text plus whatever native type Excel preserved. */
export function readCell(value: RawCell): CellRead {
  if (value === null || value === undefined) return EMPTY;

  if (typeof value === "string") {
    const text = sanitizeText(value);
    if (!text) return EMPTY;
    if (looksLikeFormula(text)) {
      return { ...EMPTY, problem: "the cell starts like a formula, which is not accepted" };
    }
    return { text, problem: null, date: null, number: null };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ...EMPTY, problem: "the cell holds an invalid number" };
    return { text: String(value), problem: null, date: null, number: value };
  }

  if (typeof value === "boolean") {
    return { text: value ? "TRUE" : "FALSE", problem: null, date: null, number: null };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { ...EMPTY, problem: "the cell holds an invalid date" };
    return { text: isoFromDate(value), problem: null, date: value, number: null };
  }

  if (isRecord(value)) {
    if ("error" in value && value.error) {
      return { ...EMPTY, problem: `the cell holds an Excel error (${String(value.error)})` };
    }
    // A live formula: take the cached result, never the expression.
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: unknown }).result;
      if (result === undefined || result === null) {
        return {
          ...EMPTY,
          problem: "the cell is a formula with no saved result — paste it as a value first",
        };
      }
      if (isRecord(result) && "error" in result) {
        return { ...EMPTY, problem: `the formula evaluates to ${String(result.error)}` };
      }
      return readCell(result as RawCell);
    }
    if (Array.isArray((value as { richText?: unknown }).richText)) {
      const joined = (value as { richText: { text?: unknown }[] }).richText
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
      return readCell(joined);
    }
    if ("text" in value) return readCell((value as { text?: unknown }).text as RawCell);
  }

  return EMPTY;
}

/* ------------------------------------------------------------------- dates */

function isoFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  // a lead follow-up in 1998 or 2140 is a typo, not a date
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** exceljs builds the Date for a date-formatted cell in UTC, so it has to be read
 *  back in UTC — reading it locally moves the day west of Greenwich. */
function isoFromDate(value: Date): string {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Excel's day 1 is 1900-01-01 and it believes 1900 was a leap year, which puts
 *  the real epoch at 1899-12-30. */
function isoFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  return isoFromDate(new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000));
}

/** Day-first, like the rest of this app (`en-IN`). Accepts DD-MM-YYYY, DD/MM/YYYY,
 *  YYYY-MM-DD, "12 Aug 2026" and a raw Excel serial. */
export function parseDate(cell: CellRead): { iso: string | null; problem: string | null } {
  if (cell.date) return { iso: isoFromDate(cell.date), problem: null };
  if (cell.number !== null) {
    const iso = isoFromSerial(cell.number);
    return iso ? { iso, problem: null } : { iso: null, problem: "not a date" };
  }

  const text = cell.text;
  if (!text) return { iso: null, problem: null };

  const ymd = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const value = isoFromParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    return value ? { iso: value, problem: null } : { iso: null, problem: "not a real date" };
  }

  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const value = isoFromParts(year, month, day);
    if (value) return { iso: value, problem: null };
    // 07/28/2026 is a US-ordered date; say so rather than "not a real date"
    if (day > 12 && month > 12) return { iso: null, problem: "not a real date" };
    if (month > 12) {
      return { iso: null, problem: "not a real date — dates are read day-first, as DD-MM-YYYY" };
    }
    return { iso: null, problem: "not a real date" };
  }

  const named = text
    .toLowerCase()
    .match(/^(?:(\d{1,2})[\s-]([a-z]{3,})[\s-](\d{4})|([a-z]{3,})[\s-](\d{1,2}),?[\s-](\d{4}))$/);
  if (named) {
    const day = Number(named[1] ?? named[5]);
    const month = MONTHS.indexOf((named[2] ?? named[4] ?? "").slice(0, 3)) + 1;
    const year = Number(named[3] ?? named[6]);
    if (month > 0) {
      const value = isoFromParts(year, month, day);
      if (value) return { iso: value, problem: null };
    }
  }

  return { iso: null, problem: "not a date — use DD-MM-YYYY" };
}

/* ----------------------------------------------------------------- numbers */

export function parseNumber(cell: CellRead): { value: number | null; problem: string | null } {
  if (cell.number !== null) return { value: cell.number, problem: null };
  if (!cell.text) return { value: null, problem: null };

  // "₹ 2,50,000.00" and "2 50 000" both mean the same thing here
  const cleaned = cell.text.replace(/[₹$€£,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: null, problem: "not a number" };
  const value = Number(cleaned);
  return Number.isFinite(value) ? { value, problem: null } : { value: null, problem: "not a number" };
}

/* ------------------------------------------------------------------ emails */

/** Deliberately conservative: one @, no spaces, a dotted domain. Anything this
 *  rejects would bounce anyway, and an email is a business key here. */
const EMAIL_RE = /^[^\s@,;<>()[\]\\]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function parseEmail(text: string): { value: string | null; problem: string | null } {
  if (!text) return { value: null, problem: null };
  const value = text.replace(/^mailto:/i, "").trim().toLowerCase();
  if (value.length > 254) return { value: null, problem: "longer than 254 characters" };
  if (!EMAIL_RE.test(value)) return { value: null, problem: "not a valid email address" };
  return { value, problem: null };
}

/* ------------------------------------------------------------------ phones */

export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/** The comparable part of a phone number.
 *
 *  This CRM's stored numbers are a mix of `9765474583` and `+91 98200 12345`, so
 *  comparing full digit strings would treat one person's two spellings as two
 *  people. The last ten digits are the subscriber number in every plan this
 *  company sells into, and that is all this is used for: deduplicating rows that
 *  carry no email. It never decides that two *leads* are the same — email and
 *  lead id do that. */
export function phoneKey(text: string): string {
  const digits = digitsOf(text);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Kept as typed (whitespace tidied) so the CRM shows the rep what they expect;
 *  only the digit count is policed, since numbering plans differ per country. */
export function parsePhone(text: string): { value: string | null; problem: string | null } {
  if (!text) return { value: null, problem: null };
  if (!/^\+?[\d\s().-]+$/.test(text)) {
    return { value: null, problem: "contains characters that are not part of a phone number" };
  }
  const digits = digitsOf(text);
  if (digits.length < 7) return { value: null, problem: "too short — needs at least 7 digits" };
  if (digits.length > 15) return { value: null, problem: "too long — at most 15 digits" };
  return { value: text.replace(/\s+/g, " ").trim(), problem: null };
}

/* -------------------------------------------------------------------- urls */

export function parseUrl(text: string): { value: string | null; problem: string | null } {
  if (!text) return { value: null, problem: null };
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { value: null, problem: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { value: null, problem: "only http and https links are accepted" };
  }
  if (!url.hostname.includes(".")) return { value: null, problem: "not a valid URL" };
  return { value: url.toString(), problem: null };
}

/* -------------------------------------------------------------------- uuid */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(text: string): { value: string | null; problem: string | null } {
  if (!text) return { value: null, problem: null };
  const value = text.toLowerCase();
  if (!UUID_RE.test(value)) return { value: null, problem: "not a valid Lead ID" };
  return { value, problem: null };
}

/* ---------------------------------------------------------------- matching */

/** Case- and punctuation-insensitive key for matching a company or a stage by
 *  name: "Zephyr Labs Pvt. Ltd." and "zephyr labs pvt ltd" are one account. */
export function loosely(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
