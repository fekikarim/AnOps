import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

type XlsxInput = Parameters<ExcelJS.Xlsx["load"]>[0];
import { buildWorkbook, exportFileName, toCellValue } from "@/server/exports/workbook";

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as XlsxInput);
  return workbook;
}

describe("toCellValue (formula-injection protection)", () => {
  it.each(["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"])("stores %j as literal text, not a formula", (value) => {
    const cell = toCellValue(value);
    expect(cell).toEqual({ richText: [{ text: value }] });
  });

  it("leaves ordinary text as a plain string", () => {
    expect(toCellValue("Widget A")).toBe("Widget A");
  });

  it("keeps numbers, dates, booleans and nulls as typed values", () => {
    const date = new Date("2026-10-27T09:30:00Z");
    expect(toCellValue(-5)).toBe(-5);
    expect(toCellValue(0.25)).toBe(0.25);
    expect(toCellValue(date)).toBe(date);
    expect(toCellValue(true)).toBe(true);
    expect(toCellValue(null)).toBeNull();
  });

  it("removes control characters and caps the length", () => {
    expect(toCellValue("ab\u0000c\u0007d")).toBe("abcd");
    expect((toCellValue("x".repeat(40_000)) as string).length).toBe(32_000);
  });
});

describe("buildWorkbook", () => {
  const generatedAt = new Date("2026-10-27T09:30:00Z");

  it("writes a readable workbook with the summary first and frozen, filterable headers", async () => {
    const buffer = await buildWorkbook({
      title: "Products",
      generatedAt,
      summary: [["Status", "Active"]],
      notes: ["A note."],
      sheets: [
        {
          name: "Products",
          columns: [
            { header: "SKU", width: 12 },
            { header: "Cost (TND)", width: 12, format: "money", currency: "TND" },
            { header: "Updated", width: 16, format: "datetime" },
          ],
          rows: [
            ["REP-A", 2, generatedAt],
            ["REP-C", 3.5, null],
          ],
        },
      ],
    });

    const workbook = await load(buffer);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(["Summary", "Products"]);

    const sheet = workbook.getWorksheet("Products")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "SKU", "Cost (TND)", "Updated"]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:C1");
    expect(sheet.getRow(3).getCell(2).value).toBe(3.5);
    expect(sheet.getRow(3).getCell(2).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.getRow(2).getCell(2).numFmt).toBe('"TND" #,##0.000');
    expect(sheet.getRow(2).getCell(3).numFmt).toBe("yyyy-mm-dd hh:mm");
    expect(sheet.getRow(2).getCell(3).value).toBeInstanceOf(Date);
  });

  it("does not create formulas from untrusted text, and keeps the text readable", async () => {
    const buffer = await buildWorkbook({
      title: "Suppliers",
      generatedAt,
      summary: [],
      notes: [],
      sheets: [{ name: "Suppliers", columns: [{ header: "Name", width: 20 }], rows: [["=cmd|' /C calc'!A0"], ["-2+3"]] }],
    });
    const sheet = (await load(buffer)).getWorksheet("Suppliers")!;

    for (const rowNumber of [2, 3]) {
      const cell = sheet.getRow(rowNumber).getCell(1);
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
    }
    expect(sheet.getRow(2).getCell(1).text).toBe("=cmd|' /C calc'!A0");
    expect(sheet.getRow(3).getCell(1).text).toBe("-2+3");
  });

  it("keeps negative numbers numeric so signed quantities still sum", async () => {
    const buffer = await buildWorkbook({
      title: "Movements",
      generatedAt,
      summary: [],
      notes: [],
      sheets: [{ name: "Movements", columns: [{ header: "Signed", width: 10, format: "quantity" }], rows: [[-30], [40]] }],
    });
    const sheet = (await load(buffer)).getWorksheet("Movements")!;
    expect(sheet.getRow(2).getCell(1).value).toBe(-30);
    expect(sheet.getRow(3).getCell(1).value).toBe(40);
  });

  it("produces a valid workbook when there are no rows", async () => {
    const buffer = await buildWorkbook({
      title: "Products",
      generatedAt,
      summary: [["Rows exported", "0"]],
      notes: ["No records match the selected filters."],
      sheets: [{ name: "Products", columns: [{ header: "SKU", width: 12 }], rows: [] }],
    });
    const workbook = await load(buffer);
    expect(workbook.getWorksheet("Products")!.rowCount).toBe(1);
    const summaryText: string[] = [];
    workbook.getWorksheet("Summary")!.eachRow((row) => summaryText.push((row.values as unknown[]).join(" ")));
    expect(summaryText.join("\n")).toContain("No records match the selected filters.");
  });
});

describe("exportFileName", () => {
  it("uses the report name and the server date", () => {
    expect(exportFileName("purchase-orders", new Date("2026-10-27T23:59:00Z"))).toBe("purchase-orders-2026-10-27.xlsx");
  });
});
