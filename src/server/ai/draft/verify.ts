import "server-only";
import type { AiProvenance } from "@/server/db/documents";

/** Checks of what the model claims against what the person actually wrote. Shared by scalar fields and line items. */
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const appears = (needle: string, hay: string) => needle.trim().length >= 2 && norm(hay).includes(norm(needle));
export const numbersIn = (text: string) => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));

/** "12 TND" -> "12". Only touches a number with at most a short unit or currency suffix, never identifiers such as OIL-001. */
export function cleanNumeric(value: string): string {
  return /^\s*-?\d[\d\s.,]*\s*[A-Za-z$€]{0,4}\s*$/.test(value) ? value.replace(/[^0-9.,-]/g, "").replace(",", ".") : value;
}

/** Provenance of a free-text or numeric value: the person said it, or the AI assumed it. */
export function statedProvenance(value: string, basis: string, evidence: string | undefined, text: string): AiProvenance {
  if (basis === "assumed") return "inferred";
  if (/^-?\d+(?:\.\d+)?$/.test(value) && numbersIn(text).includes(Number(value))) return "you";
  return appears(value, text) || (evidence ? appears(evidence, text) : false) ? "you" : "inferred";
}
