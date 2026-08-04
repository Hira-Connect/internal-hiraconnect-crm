/** The canonical bulk-upload column contract.
 *
 *  One definition, used by three things that must never drift apart: the template
 *  the user downloads, the parser that reads their file back, and the validator.
 *  Change a header here and all three follow.
 *
 *  Pure — safe on the server and in the browser.
 */

import type { ImportFieldId } from "./types";

export type CellKind = "text" | "uuid" | "email" | "phone" | "url" | "date" | "number" | "enum";

export interface ColumnSpec {
  id: ImportFieldId;
  /** The exact header written into the template. */
  header: string;
  /** Headers we also accept when reading, so a re-typed sheet still works. */
  aliases?: string[];
  kind: CellKind;
  /** A value is mandatory in every row. Column *presence* is always mandatory. */
  valueRequired: boolean;
  maxLength?: number;
  /** Fixed choices. Stage and Owner are filled in at runtime from the database. */
  options?: string[];
  width: number;
  /** Shown in the template's Instructions sheet and as a cell comment. */
  help: string;
  example: string;
}

/** Sources the lead form offers. Keeping the importer to the same list is what
 *  keeps the source-ROI report readable. */
export const IMPORT_SOURCES = [
  "Referral",
  "Website Signup",
  "Inbound",
  "Outbound",
  "LinkedIn",
  "Event",
  "Partner",
  "Other",
];

export const IMPORT_PRIORITIES = ["high", "normal", "low"];

export const COLUMNS: ColumnSpec[] = [
  {
    id: "lead_id",
    header: "Lead ID",
    aliases: ["id", "leadid", "crm id"],
    kind: "uuid",
    valueRequired: false,
    width: 38,
    help: "Leave blank for a new lead. Fill it only to update one specific existing lead — copy it from the lead's page URL.",
    example: "",
  },
  {
    id: "name",
    header: "Name",
    aliases: ["lead name", "full name", "contact name"],
    kind: "text",
    valueRequired: true,
    maxLength: 120,
    width: 24,
    help: "REQUIRED. The person you are selling to.",
    example: "Neha Kulkarni",
  },
  {
    id: "company",
    header: "Company",
    aliases: ["company name", "account", "organisation", "organization"],
    kind: "text",
    valueRequired: false,
    maxLength: 160,
    width: 24,
    help: "Matched to an existing company by name (case-insensitive). A company that does not exist yet is created.",
    example: "Zephyr Labs",
  },
  {
    id: "title",
    header: "Job Title",
    aliases: ["title", "designation", "role"],
    kind: "text",
    valueRequired: false,
    maxLength: 120,
    width: 22,
    help: "Feeds the decision-maker part of the fit score. e.g. Head of Talent, VP HR.",
    example: "Head of Talent Acquisition",
  },
  {
    id: "email",
    header: "Email",
    aliases: ["email address", "e-mail", "work email"],
    kind: "email",
    valueRequired: false,
    maxLength: 254,
    width: 30,
    help: "The identity of a lead. A row whose email matches an existing lead UPDATES that lead instead of creating a second one. Without an email (and without a Lead ID) a row can never be matched, so it always creates.",
    example: "neha@zephyrlabs.com",
  },
  {
    id: "phone",
    header: "Phone",
    aliases: ["mobile", "contact number", "phone number"],
    kind: "phone",
    valueRequired: false,
    maxLength: 32,
    width: 18,
    help: "7–15 digits. + and spaces are fine. Format the column as Text in Excel so leading zeros survive.",
    example: "+91 98200 12345",
  },
  {
    id: "whatsapp",
    header: "WhatsApp",
    aliases: ["whats app", "wa"],
    kind: "phone",
    valueRequired: false,
    maxLength: 32,
    width: 18,
    help: "Same format as Phone. Leave blank to reuse nothing — it is not copied from Phone.",
    example: "+91 98200 12345",
  },
  {
    id: "linkedin",
    header: "LinkedIn",
    aliases: ["linkedin url", "linkedin profile"],
    kind: "url",
    valueRequired: false,
    maxLength: 300,
    width: 34,
    help: "Full profile URL, e.g. https://linkedin.com/in/…",
    example: "https://linkedin.com/in/neha-kulkarni",
  },
  {
    id: "status",
    header: "Stage",
    aliases: ["status", "pipeline stage"],
    kind: "enum",
    valueRequired: false,
    width: 20,
    help: "Pick from the dropdown. Blank means New. New leads can only start in an open stage — move a lead to Won/Lost from the app, which records the reason and the history.",
    example: "Contacted",
  },
  {
    id: "source",
    header: "Source",
    aliases: ["lead source", "channel"],
    kind: "enum",
    valueRequired: false,
    options: IMPORT_SOURCES,
    width: 18,
    help: "Pick from the dropdown. Referral and inbound score higher than cold outbound.",
    example: "Referral",
  },
  {
    id: "owner_email",
    header: "Owner Email",
    aliases: ["owner", "assigned to", "sales rep"],
    kind: "email",
    valueRequired: false,
    maxLength: 254,
    width: 28,
    help: "The teammate who owns the lead, by their login email. Only managers and admins may assign to someone else; a rep's rows are always owned by the rep. Blank keeps the current owner on an update, and assigns to you on a new lead.",
    example: "",
  },
  {
    id: "next_action",
    header: "Next Action",
    aliases: ["next step", "action"],
    kind: "text",
    valueRequired: false,
    maxLength: 200,
    width: 26,
    help: "The one thing to do next, e.g. “Send proposal”.",
    example: "Send intro deck",
  },
  {
    id: "next_action_date",
    header: "Follow-up Date",
    aliases: ["next action date", "follow up date", "followup"],
    kind: "date",
    valueRequired: false,
    width: 16,
    help: "DD-MM-YYYY (a real Excel date works too). This is what the follow-up queue sorts on.",
    example: "12-08-2026",
  },
  {
    id: "expected_value",
    header: "Expected Value (INR)",
    aliases: ["deal value", "value", "expected value", "amount"],
    kind: "number",
    valueRequired: false,
    width: 20,
    help: "Whole rupees, digits only — no ₹, no “L”, no “Cr”. Leave blank if unknown.",
    example: "250000",
  },
  {
    id: "close_date",
    header: "Expected Close Date",
    aliases: ["close date", "closing date"],
    kind: "date",
    valueRequired: false,
    width: 18,
    help: "DD-MM-YYYY. When you expect this to close.",
    example: "30-09-2026",
  },
  {
    id: "priority",
    header: "Priority",
    aliases: ["prio"],
    kind: "enum",
    valueRequired: false,
    options: IMPORT_PRIORITIES,
    width: 12,
    help: "high, normal or low. Blank leaves it unset.",
    example: "normal",
  },
  {
    id: "lost_reason",
    header: "Lost Reason",
    aliases: ["reason", "delay reason", "lost/delay reason"],
    kind: "text",
    valueRequired: false,
    maxLength: 300,
    width: 28,
    help: "REQUIRED when you move an existing lead to Lost or Delayed — the same rule the app enforces. Ignored otherwise.",
    example: "",
  },
  {
    id: "notes",
    header: "Notes",
    aliases: ["note", "comments", "remarks"],
    kind: "text",
    valueRequired: false,
    maxLength: 2000,
    width: 40,
    help: "Optional. Logged on the lead's timeline as a note, exactly as if you had typed it there.",
    example: "Met at the Bangalore TA meetup. Hiring 20 engineers this quarter.",
  },
];

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

export function headerFor(id: ImportFieldId): string {
  return COLUMN_BY_ID.get(id)?.header ?? id;
}

/** Loose header comparison: case, spaces and punctuation stop mattering.
 *  Dropping everything that is not a letter or a digit also disposes of the
 *  non-breaking spaces Excel likes to leave behind in a pasted header. */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_LOOKUP = new Map<string, ImportFieldId>();
for (const col of COLUMNS) {
  HEADER_LOOKUP.set(normalizeHeader(col.header), col.id);
  for (const alias of col.aliases ?? []) HEADER_LOOKUP.set(normalizeHeader(alias), col.id);
}

export function fieldForHeader(header: string): ImportFieldId | null {
  return HEADER_LOOKUP.get(normalizeHeader(header)) ?? null;
}

/** Where the data starts. Row 1 is the header — the row numbers the user sees. */
export const HEADER_ROW = 1;
export const FIRST_DATA_ROW = 2;

export const SHEET_NAME = "Leads";
export const INSTRUCTIONS_SHEET = "How to fill this in";

/** Hard limits. Both are enforced server-side; the UI only mirrors them. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
/** Rows per processing round-trip. Small enough to stay far inside a request
 *  timeout, large enough that a 500-row file is ~20 calls. */
export const CHUNK_SIZE = 25;

/** .xlsx only. Macro-enabled workbooks (.xlsm) are refused on the way in: we
 *  never execute one, but there is no reason to accept a macro payload at all. */
export const ACCEPTED_EXTENSIONS = [".xlsx"];
export const ACCEPTED_MIME = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
/** The four bytes every OOXML file starts with — a zip local file header. */
export const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];
