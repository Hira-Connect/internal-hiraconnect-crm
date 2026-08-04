/** The workbook layer, round-tripped through real .xlsx bytes.
 *  Needs `--conditions=react-server` (see the `test` script) because
 *  lib/import/workbook.ts is `server-only`. */

import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildTemplate, looksLikeXlsx, parseWorkbook, WorkbookError } from "./import/workbook";
import { COLUMNS, SHEET_NAME } from "./import/schema";

const STAGES = [
  { key: "New", category: "open" },
  { key: "Contacted", category: "open" },
  { key: "Won", category: "won" },
  { key: "Lost", category: "lost" },
];

const template = () => buildTemplate({ stages: STAGES, ownerEmails: ["rep@hira.com"] });

/** Opens the template and hands back its Leads sheet for editing. */
async function openTemplate() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await template()) as never);
  return { wb, sheet: wb.getWorksheet(SHEET_NAME)! };
}

async function bytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
}

/** Fills one data row from a field → value map. */
function fill(sheet: ExcelJS.Worksheet, rowNumber: number, values: Record<string, string>) {
  COLUMNS.forEach((col, index) => {
    if (values[col.id] !== undefined) sheet.getCell(rowNumber, index + 1).value = values[col.id];
  });
}

test("the template we hand out is a file we can read back", async () => {
  const parsed = await parseWorkbook(await template());
  assert.deepEqual(parsed.missingColumns, []);
  assert.deepEqual(parsed.duplicateColumns, []);
  assert.deepEqual(parsed.extraColumns, []);
  assert.equal(parsed.empty, true, "an unfilled template holds no leads");
  assert.ok(parsed.blankRows > 0, "its pre-formatted rows are counted as blank, not as data");
});

test("a filled row survives the round trip with its types intact", async () => {
  const { wb, sheet } = await openTemplate();
  fill(sheet, 2, {
    name: "Neha Kulkarni",
    company: "Zephyr Labs",
    email: "NEHA@Zephyrlabs.com",
    phone: "+91 98200 12345",
    status: "Contacted",
  });
  sheet.getCell(2, COLUMNS.findIndex((c) => c.id === "close_date") + 1).value = new Date(Date.UTC(2026, 8, 30));
  sheet.getCell(2, COLUMNS.findIndex((c) => c.id === "expected_value") + 1).value = 250000;

  const parsed = await parseWorkbook(await bytes(wb));
  assert.equal(parsed.rows.length, 1);
  const cells = parsed.rows[0].cells;
  assert.equal(parsed.rows[0].rowNumber, 2, "the row number is the one shown in Excel");
  assert.equal(cells.name?.text, "Neha Kulkarni");
  assert.equal(cells.close_date?.date?.toISOString().slice(0, 10), "2026-09-30");
  assert.equal(cells.expected_value?.number, 250000);
});

test("a gap between two leads is a blank row, not an error", async () => {
  const { wb, sheet } = await openTemplate();
  fill(sheet, 2, { name: "First" });
  fill(sheet, 5, { name: "Second" });

  const parsed = await parseWorkbook(await bytes(wb));
  assert.deepEqual(
    parsed.rows.map((r) => r.rowNumber),
    [2, 5],
    "row numbers keep pointing at the right line in the user's sheet",
  );
});

test("a renamed column is reported by name instead of silently dropping data", async () => {
  const { wb, sheet } = await openTemplate();
  sheet.getCell(1, COLUMNS.findIndex((c) => c.id === "email") + 1).value = "Contact Email ID";

  const parsed = await parseWorkbook(await bytes(wb));
  assert.deepEqual(parsed.missingColumns, ["Email"]);
  assert.deepEqual(parsed.extraColumns, ["Contact Email ID"]);
  assert.equal(parsed.rows.length, 0, "nothing is parsed once the header is broken");
});

test("the same column twice is refused rather than guessed at", async () => {
  const { wb, sheet } = await openTemplate();
  sheet.getCell(1, COLUMNS.length + 1).value = "Email Address";

  const parsed = await parseWorkbook(await bytes(wb));
  assert.deepEqual(parsed.duplicateColumns, ["Email Address"]);
});

test("columns the importer does not use are ignored, not fatal", async () => {
  const { wb, sheet } = await openTemplate();
  sheet.getCell(1, COLUMNS.length + 1).value = "Internal ref";
  fill(sheet, 2, { name: "Neha" });

  const parsed = await parseWorkbook(await bytes(wb));
  assert.deepEqual(parsed.missingColumns, []);
  assert.deepEqual(parsed.extraColumns, ["Internal ref"]);
  assert.equal(parsed.rows.length, 1);
});

test("column order does not matter", async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(SHEET_NAME);
  const reversed = [...COLUMNS].reverse();
  reversed.forEach((col, index) => {
    sheet.getCell(1, index + 1).value = col.header;
  });
  sheet.getCell(2, reversed.findIndex((c) => c.id === "name") + 1).value = "Out of order";

  const parsed = await parseWorkbook(await bytes(wb));
  assert.deepEqual(parsed.missingColumns, []);
  assert.equal(parsed.rows[0].cells.name?.text, "Out of order");
});

test("a workbook with a header and nothing else is empty, not an error", async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(SHEET_NAME);
  COLUMNS.forEach((col, index) => {
    sheet.getCell(1, index + 1).value = col.header;
  });

  const parsed = await parseWorkbook(await bytes(wb));
  assert.equal(parsed.empty, true);
  assert.equal(parsed.rows.length, 0);
});

test("anything that is not an xlsx is refused before it is unpacked", async () => {
  assert.equal(looksLikeXlsx(new TextEncoder().encode("id,name\n1,Neha")), false);
  assert.equal(looksLikeXlsx((await template()).slice(0, 8)), true);

  await assert.rejects(
    () => parseWorkbook(new TextEncoder().encode("id,name\n1,Neha")),
    (error: unknown) => error instanceof WorkbookError && /not an Excel .xlsx file/.test((error as Error).message),
  );
  // a real zip that is not a workbook gets past the magic bytes and is caught by the reader
  await assert.rejects(
    () => parseWorkbook(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])),
    (error: unknown) => error instanceof WorkbookError,
  );
});

test("a sheet named something else is still read, so a re-saved file works", async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Sheet1");
  COLUMNS.forEach((col, index) => {
    sheet.getCell(1, index + 1).value = col.header;
  });
  sheet.getCell(2, COLUMNS.findIndex((c) => c.id === "name") + 1).value = "Renamed sheet";

  const parsed = await parseWorkbook(await bytes(wb));
  assert.equal(parsed.rows[0].cells.name?.text, "Renamed sheet");
});

test("a formula in a data cell is refused rather than stored", async () => {
  const { wb, sheet } = await openTemplate();
  const nameColumn = COLUMNS.findIndex((c) => c.id === "name") + 1;
  sheet.getCell(2, nameColumn).value = { formula: 'HYPERLINK("http://evil","Neha")', result: "Neha" };
  sheet.getCell(3, nameColumn).value = "=cmd|'/c calc'!A1";

  const parsed = await parseWorkbook(await bytes(wb));
  assert.equal(parsed.rows[0].cells.name?.text, "Neha", "a formula contributes only its cached result");
  assert.ok(parsed.rows[1].cells.name?.problem, "text that starts like a formula is refused");
});
