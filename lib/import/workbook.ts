import "server-only";

/** Everything that touches a real .xlsx file: the template we hand out, the
 *  parser that reads it back, and the error report.
 *
 *  exceljs is heavy and node-only, so it is imported dynamically — the same
 *  treatment nodemailer gets in lib/email/send.ts, and for the same reason.
 */

import type { Worksheet } from "exceljs";
import {
  COLUMNS,
  FIRST_DATA_ROW,
  HEADER_ROW,
  INSTRUCTIONS_SHEET,
  MAX_ROWS,
  SHEET_NAME,
  XLSX_MAGIC,
  fieldForHeader,
} from "./schema";
import { readCell, type RawCell } from "./normalize";
import type { RawRow } from "./validate";
import type { ImportFieldId, ImportRowRecord, ImportBatch } from "./types";

async function exceljs() {
  return (await import("exceljs")).default;
}

/** exceljs ships its own module-scoped `Buffer` declaration (`extends ArrayBuffer`)
 *  which does not line up with Node's. At runtime both sides are a Node Buffer, so
 *  these two casts sit at the boundary and the rest of the file speaks Uint8Array. */
type ExcelBuffer = Parameters<InstanceType<Awaited<ReturnType<typeof exceljs>>["Workbook"]>["xlsx"]["load"]>[0];

const asExcelBuffer = (bytes: Uint8Array): ExcelBuffer => bytes as unknown as ExcelBuffer;
const asBytes = (buffer: unknown): Uint8Array => buffer as Uint8Array;

const BRAND = "FF12336B"; // navy-900, the header bar in the app
const GOLD = "FFB88A2B";
const LIGHT = "FFF3F5F9";

/** Rows the template pre-formats for data entry. Anything past this still works,
 *  it just arrives without the dropdowns. */
const TEMPLATE_ROWS = 500;

export interface TemplateContext {
  /** Active stages, in pipeline order. */
  stages: { key: string; category: string }[];
  /** Login emails of people this user may assign to. Empty for a rep. */
  ownerEmails: string[];
}

/* ------------------------------------------------------------------ template */

export async function buildTemplate(ctx: TemplateContext): Promise<Uint8Array> {
  const ExcelJS = await exceljs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "HIRA Connect CRM";
  wb.created = new Date();

  const sheet = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const guide = wb.addWorksheet(INSTRUCTIONS_SHEET);
  // The dropdown sources live out of the way; hidden so nobody edits them by hand.
  const lists = wb.addWorksheet("Lists", { state: "veryHidden" });

  /* ---------------------------------------------------------------- lists */
  const stageKeys = ctx.stages.map((s) => s.key);
  const listColumns: { header: string; values: string[] }[] = [
    { header: "Stages", values: stageKeys },
    { header: "Sources", values: COLUMNS.find((c) => c.id === "source")?.options ?? [] },
    { header: "Priorities", values: COLUMNS.find((c) => c.id === "priority")?.options ?? [] },
    { header: "Owners", values: ctx.ownerEmails },
  ];
  listColumns.forEach((col, index) => {
    lists.getCell(1, index + 1).value = col.header;
    col.values.forEach((value, row) => {
      lists.getCell(row + 2, index + 1).value = value;
    });
  });
  const listRange = (index: number, count: number) =>
    count > 0 ? `Lists!$${String.fromCharCode(65 + index)}$2:$${String.fromCharCode(65 + index)}$${count + 1}` : null;

  /* --------------------------------------------------------------- headers */
  sheet.columns = COLUMNS.map((col) => ({ key: col.id, width: col.width }));

  COLUMNS.forEach((col, index) => {
    const cell = sheet.getCell(HEADER_ROW, index + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.valueRequired ? GOLD : BRAND } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND } } };
    // Hovering a header explains the column without leaving the sheet.
    cell.note = {
      texts: [{ text: `${col.valueRequired ? "REQUIRED. " : ""}${col.help}` }],
      margins: { insetmode: "auto" },
    };
    cell.protection = { locked: true };
  });
  sheet.getRow(HEADER_ROW).height = 30;
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: COLUMNS.length },
  };

  /* ------------------------------------------------ data cells + dropdowns */
  COLUMNS.forEach((col, index) => {
    const column = sheet.getColumn(index + 1);
    // Unlock the data area; the protected header above stays locked, which is
    // what stops a well-meaning edit from renaming a column we parse by name.
    column.protection = { locked: false };
    if (col.kind === "phone" || col.kind === "uuid") {
      // stop Excel turning +91 98… into a formula and 0091… into 91
      column.numFmt = "@";
    }
    if (col.kind === "number") column.numFmt = "#,##0";
    if (col.kind === "date") column.numFmt = "dd-mm-yyyy";
  });

  const dropdowns: { field: ImportFieldId; listIndex: number; count: number }[] = [
    { field: "status", listIndex: 0, count: stageKeys.length },
    { field: "source", listIndex: 1, count: listColumns[1].values.length },
    { field: "priority", listIndex: 2, count: listColumns[2].values.length },
    { field: "owner_email", listIndex: 3, count: ctx.ownerEmails.length },
  ];

  for (const { field, listIndex, count } of dropdowns) {
    const formula = listRange(listIndex, count);
    if (!formula) continue;
    const columnIndex = COLUMNS.findIndex((c) => c.id === field) + 1;
    for (let row = FIRST_DATA_ROW; row < FIRST_DATA_ROW + TEMPLATE_ROWS; row += 1) {
      sheet.getCell(row, columnIndex).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorTitle: "Pick from the list",
        error: "Choose one of the offered values, or leave the cell blank.",
      };
    }
  }

  // Locked headers only mean anything once the sheet itself is protected.
  // Everything a person legitimately does to their own data stays allowed;
  // only the column structure is frozen.
  await sheet.protect("", {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: true,
    formatColumns: true,
    formatRows: true,
    insertRows: true,
    deleteRows: true,
    sort: true,
    autoFilter: true,
    insertColumns: false,
    deleteColumns: false,
  });

  /* ---------------------------------------------------------- instructions */
  writeGuide(guide, ctx);

  return asBytes(await wb.xlsx.writeBuffer());
}

function writeGuide(guide: Worksheet, ctx: TemplateContext): void {
  guide.columns = [
    { width: 24 },
    { width: 12 },
    { width: 78 },
    { width: 34 },
  ];

  const title = guide.getCell("A1");
  title.value = "Bulk lead upload — how this works";
  title.font = { bold: true, size: 14, color: { argb: BRAND } };
  guide.mergeCells("A1:D1");

  const steps = [
    "1. Fill the “Leads” sheet — one lead per row, starting at row 2. Do not rename, reorder or delete the header row; the upload matches columns by name.",
    "2. Only “Name” is mandatory. Every other column can be left blank.",
    "3. Email is how a lead is recognised. A row whose email already exists UPDATES that lead instead of creating a second one; a blank cell in that row leaves the stored value alone.",
    "4. To update one specific lead, paste its Lead ID (from the lead's page URL). Email is never overwritten in bulk — it is what identifies the lead.",
    "5. Upload the file in the CRM under Leads → Bulk upload. You will see exactly what will be created, updated or skipped before anything is written.",
    "6. Re-uploading the same file does not create duplicates.",
  ];
  steps.forEach((text, index) => {
    const cell = guide.getCell(`A${index + 3}`);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: "top" };
    guide.mergeCells(`A${index + 3}:D${index + 3}`);
    guide.getRow(index + 3).height = 28;
  });

  const headerRow = steps.length + 5;
  ["Column", "Required", "What goes in it", "Example"].forEach((label, index) => {
    const cell = guide.getCell(headerRow, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
  });

  COLUMNS.forEach((col, index) => {
    const row = headerRow + 1 + index;
    guide.getCell(row, 1).value = col.header;
    guide.getCell(row, 1).font = { bold: true };
    guide.getCell(row, 2).value = col.valueRequired ? "Yes" : "No";
    const help = guide.getCell(row, 3);
    help.value =
      col.id === "status"
        ? `${col.help} Accepted: ${ctx.stages.map((s) => s.key).join(", ")}.`
        : col.options
          ? `${col.help} Accepted: ${col.options.join(", ")}.`
          : col.help;
    help.alignment = { wrapText: true, vertical: "top" };
    guide.getCell(row, 4).value = col.example;
    guide.getCell(row, 4).alignment = { wrapText: true, vertical: "top" };
    guide.getRow(row).height = 30;
    if (index % 2 === 0) {
      for (let c = 1; c <= 4; c += 1) {
        guide.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
      }
    }
  });

  const sampleRow = headerRow + COLUMNS.length + 2;
  guide.getCell(sampleRow, 1).value = "A filled-in example";
  guide.getCell(sampleRow, 1).font = { bold: true, color: { argb: BRAND } };
  COLUMNS.forEach((col, index) => {
    guide.getCell(sampleRow + 1, index + 1).value = col.header;
    guide.getCell(sampleRow + 1, index + 1).font = { bold: true, size: 9 };
    guide.getCell(sampleRow + 2, index + 1).value = col.example;
    guide.getCell(sampleRow + 2, index + 1).font = { size: 9 };
  });
}

/* -------------------------------------------------------------------- parse */

export interface ParsedSheet {
  rows: RawRow[];
  /** Canonical columns the sheet does not have. A non-empty list stops the upload. */
  missingColumns: string[];
  /** Headers present that the processor ignores. */
  extraColumns: string[];
  /** Canonical columns that appear more than once — too ambiguous to guess. */
  duplicateColumns: string[];
  /** Rows that held nothing at all. Counted, never reported as errors. */
  blankRows: number;
  /** True when the sheet had a header but not one data row. */
  empty: boolean;
}

export class WorkbookError extends Error {}

/** A zip local-file header is the only thing every .xlsx starts with. Checking it
 *  costs nothing and rejects a renamed .exe before exceljs unpacks anything. */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return XLSX_MAGIC.every((byte, index) => bytes[index] === byte);
}

export async function parseWorkbook(buffer: Uint8Array): Promise<ParsedSheet> {
  if (!looksLikeXlsx(buffer)) {
    throw new WorkbookError("That is not an Excel .xlsx file. Download the template and fill that in.");
  }

  const ExcelJS = await exceljs();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(asExcelBuffer(buffer));
  } catch {
    throw new WorkbookError(
      "The file could not be opened — it may be damaged, password-protected, or saved in an older .xls format. Re-save it as .xlsx and try again.",
    );
  }

  const sheet =
    wb.worksheets.find((w) => w.name.trim().toLowerCase() === SHEET_NAME.toLowerCase()) ?? wb.worksheets[0];
  if (!sheet) throw new WorkbookError("The workbook has no sheets.");

  /* ------------------------------------------------------------- headers */
  const columnFor = new Map<number, ImportFieldId>();
  const seenFields = new Map<ImportFieldId, number>();
  const extraColumns: string[] = [];
  const duplicateColumns: string[] = [];

  const headerRow = sheet.getRow(HEADER_ROW);
  const width = Math.max(headerRow.cellCount, COLUMNS.length);
  for (let index = 1; index <= width; index += 1) {
    const raw = readCell(headerRow.getCell(index).value as RawCell);
    const text = raw.text;
    if (!text) continue;
    const field = fieldForHeader(text);
    if (!field) {
      extraColumns.push(text);
      continue;
    }
    if (seenFields.has(field)) {
      duplicateColumns.push(text);
      continue;
    }
    seenFields.set(field, index);
    columnFor.set(index, field);
  }

  const missingColumns = COLUMNS.filter((c) => !seenFields.has(c.id)).map((c) => c.header);
  if (missingColumns.length || duplicateColumns.length) {
    return { rows: [], missingColumns, extraColumns, duplicateColumns, blankRows: 0, empty: true };
  }

  /* ---------------------------------------------------------------- rows */
  const rows: RawRow[] = [];
  let blankRows = 0;
  // rowCount counts formatted-but-empty rows too — the template pre-formats 500
  // of them — so blank rows are skipped below rather than trusted to be absent.
  const lastRow = sheet.rowCount;

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: Partial<Record<ImportFieldId, ReturnType<typeof readCell>>> = {};
    let hasValue = false;

    for (const [index, field] of columnFor) {
      const cell = readCell(row.getCell(index).value as RawCell);
      if (cell.text || cell.problem) hasValue = true;
      cells[field] = cell;
    }

    if (!hasValue) {
      blankRows += 1;
      continue;
    }
    // Counted against data rows only: the template ships 500 pre-formatted empty
    // rows, and a sheet that ends with them is not an oversized sheet.
    if (rows.length >= MAX_ROWS) {
      throw new WorkbookError(
        `The sheet has more than ${MAX_ROWS.toLocaleString("en-IN")} rows of data. Split it into smaller files and upload them one at a time.`,
      );
    }
    rows.push({ rowNumber, cells });
  }

  return {
    rows,
    missingColumns,
    extraColumns,
    duplicateColumns,
    blankRows,
    empty: rows.length === 0,
  };
}

/* ------------------------------------------------------------- error report */

const RESULT_LABEL: Record<string, string> = {
  invalid: "Rejected — nothing was written",
  failed: "Failed — the database refused it",
  skipped: "Skipped",
  created: "Created",
  updated: "Updated",
  pending: "Not processed yet",
};

/** The report is a *re-uploadable* template: the canonical columns come first,
 *  carrying the values as they were read, and the diagnosis is bolted on at the
 *  end where the parser ignores it. Fix the cells, upload the same file. */
export async function buildErrorReport(batch: ImportBatch, rows: ImportRowRecord[]): Promise<Uint8Array> {
  const ExcelJS = await exceljs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "HIRA Connect CRM";
  wb.created = new Date();

  const sheet = wb.addWorksheet(SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });
  const diagnostics = ["Import Row #", "Import Result", "Import Error", "How To Fix"];

  sheet.columns = [
    ...COLUMNS.map((col) => ({ width: col.width })),
    { width: 12 },
    { width: 26 },
    { width: 52 },
    { width: 52 },
  ];

  [...COLUMNS.map((c) => c.header), ...diagnostics].forEach((header, index) => {
    const cell = sheet.getCell(HEADER_ROW, index + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: index >= COLUMNS.length ? "FF9B1C1C" : BRAND },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.getRow(HEADER_ROW).height = 26;

  rows.forEach((record, index) => {
    const rowNumber = index + FIRST_DATA_ROW;
    COLUMNS.forEach((col, columnIndex) => {
      const value = record.payload?.[col.id];
      if (value !== undefined && value !== null && value !== "") {
        sheet.getCell(rowNumber, columnIndex + 1).value = value;
      }
    });
    const base = COLUMNS.length;
    sheet.getCell(rowNumber, base + 1).value = record.row_number;
    sheet.getCell(rowNumber, base + 2).value = RESULT_LABEL[record.status] ?? record.status;
    sheet.getCell(rowNumber, base + 3).value = record.error ?? "";
    sheet.getCell(rowNumber, base + 4).value = record.hint ?? "";
    for (let c = base + 1; c <= base + 4; c += 1) {
      sheet.getCell(rowNumber, c).alignment = { wrapText: true, vertical: "top" };
      sheet.getCell(rowNumber, c).font = {
        color: { argb: record.status === "skipped" ? "FF92400E" : "FF9B1C1C" },
      };
    }
  });

  /* ------------------------------------------------------------- summary */
  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 30 }, { width: 52 }];
  const lines: [string, string | number][] = [
    ["File", batch.file_name],
    ["Uploaded", new Date(batch.created_at).toLocaleString("en-IN")],
    ["Upload ID", batch.id],
    ["Status", batch.status.replace(/_/g, " ")],
    ["Rows in file", batch.total_rows],
    ["Created", batch.created_count],
    ["Updated", batch.updated_count],
    ["Skipped", batch.skipped_count],
    ["Rejected by validation", batch.invalid_count],
    ["Failed while writing", batch.failed_count],
    ["First failed row", batch.first_failed_row ?? "—"],
    ["Last row processed successfully", batch.last_success_row ?? "—"],
    ["Rows in this report", rows.length],
  ];
  lines.forEach(([label, value], index) => {
    summary.getCell(index + 1, 1).value = label;
    summary.getCell(index + 1, 1).font = { bold: true };
    summary.getCell(index + 1, 2).value = value;
  });

  return asBytes(await wb.xlsx.writeBuffer());
}
