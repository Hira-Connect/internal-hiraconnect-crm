import assert from "node:assert/strict";
import test from "node:test";
import {
  digitsOf,
  looksLikeFormula,
  parseDate,
  parseEmail,
  parseNumber,
  parsePhone,
  parseUrl,
  parseUuid,
  readCell,
  sanitizeText,
} from "./import/normalize";
import { COLUMNS, fieldForHeader, normalizeHeader } from "./import/schema";
import { businessKey, planRows, rowKeysOf, type ExistingLead, type RawRow, type ValidationContext } from "./import/validate";
import type { ImportFieldId } from "./import/types";

/* ------------------------------------------------------------------- cells */

test("a cell that starts like a formula is refused, a phone number is not", () => {
  assert.equal(looksLikeFormula("=1+1"), true);
  assert.equal(looksLikeFormula("@SUM(A1)"), true);
  assert.equal(looksLikeFormula("-cmd|'/c calc'!A"), true);
  assert.equal(looksLikeFormula("+91 98200 12345"), false, "a signed number is data");
  assert.equal(looksLikeFormula("-500"), false);
  assert.equal(looksLikeFormula("Neha Kulkarni"), false);

  assert.equal(readCell("=HYPERLINK(\"http://evil\")").problem !== null, true);
  assert.equal(readCell("+91 98200 12345").text, "+91 98200 12345");
});

test("a live formula contributes its cached result, never its expression", () => {
  assert.equal(readCell({ formula: "A1&B1", result: "Neha" }).text, "Neha");
  assert.equal(readCell({ formula: "A1/0", result: { error: "#DIV/0!" } }).problem, "the formula evaluates to #DIV/0!");
  assert.ok(readCell({ formula: "A1" }).problem, "a formula with no saved result is refused");
});

test("rich text, hyperlinks and control characters are flattened", () => {
  assert.equal(readCell({ richText: [{ text: "Zephyr " }, { text: "Labs" }] }).text, "Zephyr Labs");
  assert.equal(readCell({ text: "neha@zephyr.com", hyperlink: "mailto:neha@zephyr.com" }).text, "neha@zephyr.com");
  assert.equal(sanitizeText("Line one\nline two"), "Line one line two", "no newline survives into a single-line field");
  assert.equal(sanitizeText("  spaced   out  "), "spaced out");
});

/* ------------------------------------------------------------------- dates */

const cell = (text: string) => ({ text, problem: null, date: null, number: null });

test("dates are read day-first, and a US-ordered date says so", () => {
  assert.equal(parseDate(cell("12-08-2026")).iso, "2026-08-12");
  assert.equal(parseDate(cell("12/08/2026")).iso, "2026-08-12");
  assert.equal(parseDate(cell("2026-08-12")).iso, "2026-08-12");
  assert.equal(parseDate(cell("12 Aug 2026")).iso, "2026-08-12");
  assert.equal(parseDate(cell("Aug 12, 2026")).iso, "2026-08-12");
  assert.match(parseDate(cell("07/28/2026")).problem ?? "", /day-first/);
  assert.equal(parseDate(cell("not a date")).iso, null);
  assert.equal(parseDate(cell("31-02-2026")).iso, null, "the 31st of February is not a date");
});

test("a real Excel date cell keeps its calendar day regardless of the server's timezone", () => {
  const excelDate = { text: "", problem: null, date: new Date(Date.UTC(2026, 7, 12)), number: null };
  assert.equal(parseDate(excelDate).iso, "2026-08-12");
  // serial 46246 is 2026-08-12 in Excel's 1900 system
  assert.equal(parseDate({ text: "", problem: null, date: null, number: 46246 }).iso, "2026-08-12");
});

test("a follow-up date in the wrong century is a typo, not a date", () => {
  assert.equal(parseDate(cell("12-08-1998")).iso, null);
  assert.equal(parseDate(cell("12-08-2140")).iso, null);
});

/* ------------------------------------------------------- scalar validators */

test("emails are lowercased and loosely validated", () => {
  assert.equal(parseEmail("NEHA@Zephyrlabs.com").value, "neha@zephyrlabs.com");
  assert.equal(parseEmail("mailto:neha@zephyrlabs.com").value, "neha@zephyrlabs.com");
  assert.ok(parseEmail("neha@localhost").problem, "a domain with no dot is refused");
  assert.ok(parseEmail("two @ signs@x.com").problem);
});

test("phone numbers keep their formatting but not an implausible length", () => {
  assert.equal(parsePhone("+91 98200 12345").value, "+91 98200 12345");
  assert.equal(parsePhone("(022) 4004-1234").value, "(022) 4004-1234");
  assert.ok(parsePhone("12345").problem, "five digits is not a phone number");
  assert.ok(parsePhone("1234567890123456789").problem);
  assert.ok(parsePhone("call me").problem);
  assert.equal(digitsOf("+91 98200 12345"), "919820012345");
});

test("numbers survive Indian formatting; urls and ids are strict", () => {
  assert.equal(parseNumber(cell("2,50,000")).value, 250000);
  assert.equal(parseNumber(cell("₹ 250000.00")).value, 250000);
  assert.ok(parseNumber(cell("2.5L")).problem);
  assert.equal(parseUrl("linkedin.com/in/neha").value, "https://linkedin.com/in/neha");
  assert.ok(parseUrl("javascript:alert(1)").problem, "only http(s) links are accepted");
  assert.equal(parseUuid("4CCA322A-348F-4413-84FF-B86B5E3815D2").value, "4cca322a-348f-4413-84ff-b86b5e3815d2");
  assert.ok(parseUuid("not-an-id").problem);
});

/* ----------------------------------------------------------------- headers */

test("headers match past case, spacing, punctuation and known aliases", () => {
  assert.equal(fieldForHeader("Expected Value (INR)"), "expected_value");
  assert.equal(fieldForHeader("  expected   value  "), "expected_value");
  assert.equal(fieldForHeader("E-Mail"), "email");
  assert.equal(fieldForHeader("Assigned To"), "owner_email");
  assert.equal(fieldForHeader("Something Else"), null);
  assert.equal(normalizeHeader("Follow-up Date"), "followupdate");
});

test("the diagnostic columns of the error report cannot be mistaken for data columns", () => {
  for (const header of ["Import Row #", "Import Result", "Import Error", "How To Fix"]) {
    assert.equal(fieldForHeader(header), null, `${header} must stay a comment, not a field`);
  }
});

/* ------------------------------------------------------------ planning */

function lead(over: Partial<ExistingLead> = {}): ExistingLead {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Neha Kulkarni",
    email: "neha@zephyrlabs.com",
    phone: null,
    whatsapp: null,
    linkedin: null,
    title: null,
    company_id: null,
    source: null,
    status: "New",
    owner_id: "me",
    next_action: null,
    next_action_date: null,
    expected_value: null,
    close_date: null,
    priority: null,
    ...over,
  };
}

function context(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    stages: [
      { key: "New", label: "New", category: "open", isActive: true },
      { key: "Contacted", label: "Contacted", category: "open", isActive: true },
      { key: "Delayed", label: "Delayed", category: "open", isActive: true },
      { key: "Won", label: "Won", category: "won", isActive: true },
      { key: "Lost", label: "Lost", category: "lost", isActive: true },
    ],
    companiesByName: new Map(),
    ownersByEmail: new Map([["me@hira.com", { id: "me" }], ["other@hira.com", { id: "other" }]]),
    leadsById: new Map(),
    leadsByEmail: new Map(),
    importedKeys: new Map(),
    invisibleEmails: new Set(),
    me: { id: "me" },
    canAssignOthers: true,
    ...over,
  };
}

/** Builds a row the way the parser would, from plain strings. */
function row(rowNumber: number, values: Partial<Record<ImportFieldId, string>>): RawRow {
  const cells: RawRow["cells"] = {};
  for (const spec of COLUMNS) {
    cells[spec.id] = cell(values[spec.id] ?? "");
  }
  return { rowNumber, cells };
}

test("a row with no name is rejected and never reaches the database", () => {
  const [planned] = planRows([row(2, { email: "x@y.com" })], context());
  assert.equal(planned.status, "invalid");
  assert.equal(planned.issues[0].field, "name");
});

test("a blank row is dropped rather than reported as an error", () => {
  assert.equal(planRows([row(2, {}), row(3, { name: "Real" })], context()).length, 1);
});

test("an unknown email creates, a known email updates the same lead", () => {
  const existing = lead();
  const ctx = context({
    leadsById: new Map([[existing.id, existing]]),
    leadsByEmail: new Map([[existing.email!, existing]]),
  });

  const planned = planRows(
    [
      row(2, { name: "Someone New", email: "new@zephyrlabs.com" }),
      row(3, { name: "Neha Kulkarni", email: "NEHA@zephyrlabs.com", title: "VP Talent" }),
    ],
    ctx,
  );

  assert.equal(planned[0].action, "create");
  assert.equal(planned[0].leadId, null);
  assert.equal(planned[1].action, "update", "email matching is case-insensitive");
  assert.equal(planned[1].leadId, existing.id);
});

test("an update that repeats what is already stored is skipped, not rewritten", () => {
  const existing = lead({ title: "VP Talent" });
  const ctx = context({
    leadsById: new Map([[existing.id, existing]]),
    leadsByEmail: new Map([[existing.email!, existing]]),
  });
  const [planned] = planRows([row(2, { name: existing.name, email: existing.email!, title: "VP Talent" })], ctx);
  assert.equal(planned.status, "skipped");
  assert.match(planned.issues[0].message, /nothing to update/);
});

test("a blank cell on an update means “leave it alone”, so it is not a change", () => {
  const existing = lead({ title: "VP Talent", phone: "+91 98200 12345" });
  const ctx = context({
    leadsById: new Map([[existing.id, existing]]),
    leadsByEmail: new Map([[existing.email!, existing]]),
  });
  const [same] = planRows([row(2, { name: existing.name, email: existing.email! })], ctx);
  assert.equal(same.status, "skipped");

  const [changed] = planRows([row(2, { name: existing.name, email: existing.email!, phone: "+91 90000 00000" })], ctx);
  assert.equal(changed.status, "pending");
  assert.equal(changed.action, "update");
});

test("email is never rewritten on a lead addressed by its id", () => {
  const existing = lead();
  const ctx = context({ leadsById: new Map([[existing.id, existing]]) });
  const [planned] = planRows([row(2, { lead_id: existing.id, name: "Neha", email: "somebody.else@x.com" })], ctx);

  assert.equal(planned.status, "invalid");
  assert.equal(planned.issues[0].field, "email");
  assert.match(planned.issues[0].message, /differs from the email already on this lead/);
});

test("an unknown Lead ID is refused rather than quietly creating a lead", () => {
  const [planned] = planRows([row(2, { lead_id: "22222222-2222-4222-8222-222222222222", name: "Ghost" })], context());
  assert.equal(planned.status, "invalid");
  assert.equal(planned.issues[0].field, "lead_id");
});

test("the second copy of a lead inside one file is skipped and points at the first", () => {
  const planned = planRows(
    [
      row(2, { name: "Neha", email: "neha@zephyrlabs.com" }),
      row(3, { name: "Neha", email: "NEHA@ZEPHYRLABS.COM" }),
      row(4, { name: "Neha", email: "neha@zephyrlabs.com", title: "Different" }),
    ],
    context(),
  );

  assert.equal(planned[0].action, "create");
  assert.equal(planned[1].status, "skipped");
  assert.match(planned[1].issues[0].message, /duplicate of row 2/);
  assert.match(planned[2].issues[0].hint ?? "", /disagree/, "a conflicting duplicate says the values differ");
});

test("rows with no email are deduplicated on name, company and phone", () => {
  const planned = planRows(
    [
      row(2, { name: "Ravi Menon", company: "Clover IT", phone: "+91 98200 11111" }),
      // the same person, spelled the way this CRM already stores half its numbers
      row(3, { name: "ravi  menon", company: "clover it", phone: "98200 11111" }),
    ],
    context(),
  );
  assert.equal(planned[0].action, "create");
  assert.equal(planned[1].status, "skipped");
  assert.ok(planned[0].warnings.some((w) => /cannot be matched/.test(w.message)));
});

test("a row already imported before is skipped instead of creating a second lead", () => {
  const key = businessKey({ name: "Ravi Menon", company: "Clover IT" })!;
  const ctx = context({ importedKeys: new Map([[key, { leadId: "lead-1", batchId: "batch-1" }]]) });
  const [planned] = planRows([row(2, { name: "Ravi Menon", company: "Clover IT" })], ctx);

  assert.equal(planned.status, "skipped");
  assert.equal(planned.leadId, "lead-1");
  assert.match(planned.issues[0].message, /already imported/);
});

test("an address owned by an invisible lead is skipped, and nothing about that lead is disclosed", () => {
  const ctx = context({ invisibleEmails: new Set(["taken@x.com"]) });
  const [planned] = planRows([row(2, { name: "Someone", email: "taken@x.com" })], ctx);

  assert.equal(planned.status, "skipped");
  assert.equal(planned.leadId, null, "no id of a lead the user cannot see");
  assert.match(planned.issues[0].message, /not yours to edit/);
});

test("a new lead may not start in a closed stage, but an existing one may be moved there", () => {
  const [created] = planRows([row(2, { name: "Neha", email: "n@x.com", status: "Won" })], context());
  assert.equal(created.status, "invalid");
  assert.equal(created.issues[0].field, "status");

  const existing = lead();
  const ctx = context({
    leadsById: new Map([[existing.id, existing]]),
    leadsByEmail: new Map([[existing.email!, existing]]),
  });
  const [moved] = planRows([row(2, { name: existing.name, email: existing.email!, status: "Won" })], ctx);
  assert.equal(moved.status, "pending");
  assert.equal(moved.action, "update");
});

test("moving a lead to Lost or Delayed still requires a reason", () => {
  const existing = lead();
  const ctx = context({
    leadsById: new Map([[existing.id, existing]]),
    leadsByEmail: new Map([[existing.email!, existing]]),
  });

  const [missing] = planRows([row(2, { name: existing.name, email: existing.email!, status: "Lost" })], ctx);
  assert.equal(missing.status, "invalid");
  assert.equal(missing.issues[0].field, "lost_reason");

  const [given] = planRows(
    [row(2, { name: existing.name, email: existing.email!, status: "Lost", lost_reason: "Went with a competitor" })],
    ctx,
  );
  assert.equal(given.status, "pending");
});

test("an unknown stage, source or priority is named in the error", () => {
  const planned = planRows(
    [
      row(2, { name: "A", email: "a@x.com", status: "Nurturing" }),
      row(3, { name: "B", email: "b@x.com", source: "Carrier pigeon" }),
      row(4, { name: "C", email: "c@x.com", priority: "urgent" }),
    ],
    context(),
  );
  assert.deepEqual(
    planned.map((p) => p.issues[0].field),
    ["status", "source", "priority"],
  );
});

test("only managers and admins may hand a row to somebody else", () => {
  const asRep = context({ canAssignOthers: false });
  const [refused] = planRows([row(2, { name: "A", email: "a@x.com", owner_email: "other@hira.com" })], asRep);
  assert.equal(refused.status, "invalid");
  assert.equal(refused.issues[0].field, "owner_email");

  const [own] = planRows([row(2, { name: "A", email: "a@x.com", owner_email: "me@hira.com" })], asRep);
  assert.equal(own.status, "pending", "a rep may still own their own rows");

  const [unknown] = planRows([row(2, { name: "A", email: "a@x.com", owner_email: "ghost@hira.com" })], context());
  assert.equal(unknown.status, "invalid");
});

test("a value that is too long is rejected with the limit named", () => {
  const [planned] = planRows([row(2, { name: "x".repeat(200) })], context());
  assert.equal(planned.status, "invalid");
  assert.match(planned.issues[0].message, /longer than 120 characters/);
});

test("business keys prefer the lead id, then the email, then name+company+phone", () => {
  assert.equal(businessKey({ lead_id: "abc", email: "a@x.com", name: "A" }), "lead:abc");
  assert.equal(businessKey({ email: "a@x.com", name: "A" }), "email:a@x.com");
  assert.equal(businessKey({ name: "A B", company: "C Ltd.", phone: "+91 90000 00000" }), "nc:ab|cltd|9000000000");
  assert.equal(businessKey({ company: "C" }), null, "a row with no name has no key");
});

test("rowKeysOf reports the keys a file would claim, without deciding anything", () => {
  const keys = rowKeysOf([
    row(2, { name: "A", email: "a@x.com" }),
    row(3, { name: "B" }),
    row(4, { company: "no name here" }),
  ]);
  assert.deepEqual(keys, ["email:a@x.com", "nc:b||"]);
});
