/** Shared record shapes for the bulk lead upload.
 *  No server-only imports here — the wizard is a client component and reads these. */

export type ImportFieldId =
  | "lead_id"
  | "name"
  | "company"
  | "title"
  | "email"
  | "phone"
  | "whatsapp"
  | "linkedin"
  | "status"
  | "source"
  | "owner_email"
  | "next_action"
  | "next_action_date"
  | "expected_value"
  | "close_date"
  | "priority"
  | "lost_reason"
  | "notes";

/** What the processor intends to do with a row, decided before anything is written. */
export type RowAction = "create" | "update" | "skip";

/** Where a row ended up. `invalid` never reached the database; `failed` did and errored. */
export type RowStatus = "pending" | "created" | "updated" | "skipped" | "invalid" | "failed";

export type BatchStatus =
  | "pending"
  | "validating"
  | "processing"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled";

/** One problem with one row. `field` is null for whole-row problems. */
export interface RowIssue {
  field: ImportFieldId | null;
  message: string;
  /** What the user should do about it — shown in the UI and in the error report. */
  hint?: string;
}

/** A row after coercion + validation, before any write. */
export interface PlannedRow {
  rowNumber: number;
  /** Sanitized cell values keyed by field. Missing/blank cells are absent. */
  values: Partial<Record<ImportFieldId, string>>;
  /** Normalized business key — lead id, else email, else name+company+phone. */
  rowKey: string | null;
  /** Email or name, whichever identifies the row best in a report. */
  identifier: string;
  action: RowAction;
  status: RowStatus;
  /** Set when the row matched an existing lead. */
  leadId: string | null;
  issues: RowIssue[];
  /** Non-blocking remarks (e.g. "no email — cannot be matched later"). */
  warnings: RowIssue[];
}

export interface ImportBatch {
  id: string;
  created_by: string | null;
  file_name: string;
  file_size: number;
  file_hash: string;
  total_rows: number;
  valid_rows: number;
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  invalid_count: number;
  failed_count: number;
  status: BatchStatus;
  error: string | null;
  first_failed_row: number | null;
  last_success_row: number | null;
  duration_ms: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ImportBatchRow extends ImportBatch {
  creator: { id: string; full_name: string | null; email: string | null } | null;
}

export interface ImportRowRecord {
  id: string;
  batch_id: string;
  row_number: number;
  row_key: string | null;
  payload: Partial<Record<ImportFieldId, string>>;
  identifier: string | null;
  status: RowStatus;
  action: RowAction | null;
  lead_id: string | null;
  error: string | null;
  error_field: ImportFieldId | null;
  hint: string | null;
  processed_at: string | null;
}

/** What the user sees after validation and before confirming the upload. */
export interface ValidationPreview {
  batchId: string;
  fileName: string;
  fileSize: number;
  totalRows: number;
  /** Rows that will be attempted. */
  validRows: number;
  creates: number;
  updates: number;
  /** Duplicates inside the file, plus rows already imported previously. */
  skips: number;
  invalid: number;
  /** Blank rows dropped before validation — not an error, just noise in the sheet. */
  blankRows: number;
  /** Column names in the sheet that the processor does not use. */
  extraColumns: string[];
  /** A previous batch with the same file contents, if there is one. */
  duplicateOf: { id: string; fileName: string; createdAt: string; by: string | null } | null;
  /** First 200 problem rows, for the review table. */
  problems: {
    rowNumber: number;
    identifier: string;
    status: RowStatus;
    action: RowAction;
    message: string;
    field: ImportFieldId | null;
    hint: string | null;
  }[];
}

/** Progress returned by every processing chunk, so the UI never fakes a bar. */
export interface ChunkProgress {
  batchId: string;
  status: BatchStatus;
  totalRows: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  failed: number;
  firstFailedRow: number | null;
  lastSuccessRow: number | null;
  /** False once every row has a final outcome. */
  hasMore: boolean;
  durationMs: number | null;
  error: string | null;
}
