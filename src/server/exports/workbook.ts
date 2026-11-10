import "server-only";
import ExcelJS from "exceljs";

/**
 * Minimal, safe XLSX writer shared by every export.
 *
 * Quantities and money are written as numeric cells so they can be summed in Excel.
 * Text is untrusted: strings that start with a spreadsheet formula trigger (=, +, -, @, tab, CR)
 * are written as rich text. ExcelJS would otherwise store "=1+1" as a live formula, and rich text
 * stores the characters as literal text without an apostrophe prefix.
 */

export type CellValue = string | number | boolean | Date | null;

export type ColumnFormat = "text" | "integer" | "quantity" | "money" | "date" | "datetime";

export type Column = {
  header: string;
  width: number;
  format?: ColumnFormat;
  /** ISO 4217 code for money columns. Money without a valid code uses a plain number format. */
  currency?: string;
};

export type Sheet = {
  name: string;
  columns: Column[];
  rows: CellValue[][];
};

export type WorkbookSpec = {
  title: string;
  generatedAt: Date;
  /** Label/value pairs on the summary sheet: filters applied, row counts, and similar facts. */
  summary: Array<[string, string]>;
  /** Plain-language notes about definitions and limitations, shown on the summary sheet. */
  notes: string[];
  sheets: Sheet[];
};

const MAX_CELL_TEXT = 32_000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

const FORMATS: Record<Exclude<ColumnFormat, "text" | "quantity" | "money">, string> = {
  integer: "#,##0",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
};

/** Makes one value safe to write. Numbers, dates and booleans pass through unchanged. */
export function toCellValue(value: CellValue): ExcelJS.CellValue {
  if (value === null || typeof value === "number" || typeof value === "boolean" || value instanceof Date) {
    return value;
  }
  const clean = value.replace(CONTROL_CHARS, "").slice(0, MAX_CELL_TEXT);
  if (FORMULA_LEAD.test(clean)) return { richText: [{ text: clean }] };
  return clean;
}

function numberFormat(column: Column): string | undefined {
  switch (column.format) {
    case "integer":
    case "date":
    case "datetime":
      return FORMATS[column.format];
    case "money":
      return column.currency && CURRENCY_CODE.test(column.currency)
        ? `"${column.currency}" #,##0.000`
        : "#,##0.000";
    default:
      return undefined;
  }
}

function addDataSheet(workbook: ExcelJS.Workbook, sheet: Sheet): void {
  const ws = workbook.addWorksheet(sheet.name);
  ws.columns = sheet.columns.map((column, index) => ({ header: column.header, key: `c${index}`, width: column.width }));

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.border = { bottom: { style: "thin" } };

  const formats = sheet.columns.map(numberFormat);
  for (const row of sheet.rows) {
    const added = ws.addRow(row.map(toCellValue));
    formats.forEach((format, index) => {
      if (format) added.getCell(index + 1).numFmt = format;
    });
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (sheet.columns.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }
}

/** Builds the workbook and returns its bytes. Summary sheet first, then one sheet per data set. */
export async function buildWorkbook(spec: WorkbookSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AnOps";
  workbook.created = spec.generatedAt;
  workbook.modified = spec.generatedAt;

  const summary = workbook.addWorksheet("Summary");
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 80;
  summary.getCell("A1").value = toCellValue(spec.title);
  summary.getCell("A1").font = { bold: true, size: 14 };
  summary.addRow([]);
  summary.addRow(["Generated (UTC)", spec.generatedAt.toISOString().replace("T", " ").slice(0, 16)]);
  for (const [label, value] of spec.summary) {
    summary.addRow([toCellValue(label), toCellValue(value)]);
  }
  if (spec.notes.length > 0) {
    summary.addRow([]);
    summary.addRow(["Notes"]).font = { bold: true };
    for (const note of spec.notes) {
      summary.addRow(["", toCellValue(note)]);
    }
  }
  summary.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  for (const sheet of spec.sheets) {
    addDataSheet(workbook, sheet);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Stable, date-stamped filename such as `products-2026-10-27.xlsx`. The date comes from the server clock. */
export function exportFileName(report: string, generatedAt: Date): string {
  return `${report}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
}
