import "server-only";
import type { CommandEnv, DraftCandidate, DraftCurrent, DraftLinesSpec } from "@/server/ai/commands/types";
import { cleanNumeric, norm, statedProvenance } from "@/server/ai/draft/verify";
import type { AiProvenance } from "@/server/db/documents";

export type LineRow = Record<string, string>;
export type ModelLine = { ref: string; remove?: boolean; values: Record<string, { value: string | number | boolean; basis: string; evidence?: string }> };

export const MAX_LINE_ROWS = 100;

/** Rows travel as a JSON string in the form value. Anything that is not an array of string maps is discarded. */
export function parseRows(value: unknown, max = MAX_LINE_ROWS): LineRow[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, max)
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r))
      .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 300)])));
  } catch {
    return [];
  }
}

export const serializeRows = (rows: LineRow[]) => JSON.stringify(rows);
const humanize = (col: string) => col.replace(/([A-Z])/g, " $1").toLowerCase();

type Ask = (field: string | undefined, question: string) => void;

/**
 * Applies the model's line instructions to the rows. Each line names its record in words; the words are
 * resolved against real company data. No match, or several matches, becomes a question and changes
 * nothing. Quantities and prices the person did not state are never taken from the model.
 */
export async function applyModelLines(
  env: CommandEnv,
  spec: DraftLinesSpec,
  input: { rows: LineRow[]; prov: Record<string, AiProvenance>[]; lines: ModelLine[]; text: string; current: DraftCurrent | null },
  ask: Ask
): Promise<{ rows: LineRow[]; prov: Record<string, AiProvenance>[]; changed: boolean }> {
  const rows = input.rows.map((r) => ({ ...r }));
  const prov = input.prov.map((p) => ({ ...p }));
  let changed = false;

  for (const line of input.lines) {
    const ref = line.ref.trim();
    if (!ref) continue;
    let candidates: DraftCandidate[] = await spec.find(env, ref, input.current);
    if (candidates.length > 1) {
      const exact = candidates.filter((c) => norm(c.label) === norm(ref) || norm(c.label).startsWith(`${norm(ref)} ·`));
      if (exact.length === 1) candidates = exact;
    }
    if (candidates.length === 0) {
      ask(spec.field, `I could not find "${ref.slice(0, 60)}" in your records. Pick it from the list, or check the spelling.`);
      continue;
    }
    if (candidates.length > 1) {
      ask(spec.field, `More than one item matches "${ref.slice(0, 60)}": ${candidates.slice(0, 4).map((c) => c.label).join("; ")}. Which one?`);
      continue;
    }
    const candidate = candidates[0];
    let index = rows.findIndex((r) => r[spec.keyColumn] === candidate.id);
    if (line.remove) {
      if (index >= 0) {
        rows.splice(index, 1);
        prov.splice(index, 1);
        changed = true;
      }
      continue;
    }
    if (index < 0) {
      if (spec.fixedRows) {
        ask(spec.field, `${candidate.label} is not one of the lines on this record.`);
        continue;
      }
      if (rows.length >= MAX_LINE_ROWS) continue;
      const fresh = await spec.newRow(env, candidate);
      rows.push(fresh.row);
      prov.push({ ...fresh.provenance, [spec.keyColumn]: "found" });
      index = rows.length - 1;
      changed = true;
    }
    for (const [column, entry] of Object.entries(line.values)) {
      if (!(column in rows[index]) || column === spec.keyColumn) continue;
      const critical = spec.criticalColumns.includes(column);
      let value = String(entry.value).trim().slice(0, 300);
      if (critical) value = cleanNumeric(value);
      const p = statedProvenance(value, entry.basis, entry.evidence, input.text);
      if (critical && p === "inferred") {
        // A value the record already supplies (a product's own cost) stays; only a genuinely empty cell needs asking about.
        if ((rows[index][column] ?? "") === "") ask(spec.field, `What is the ${humanize(column)} for ${candidate.label}?`);
        continue;
      }
      if (rows[index][column] !== value) {
        rows[index][column] = value;
        prov[index][column] = p;
        changed = true;
      }
    }
  }

  for (const [i, row] of rows.entries()) {
    for (const column of spec.requiredColumns) {
      if ((row[column] ?? "").trim() === "") ask(spec.field, `What is the ${humanize(column)} for ${row.label ?? `line ${i + 1}`}?`);
    }
  }
  return { rows, prov, changed };
}
