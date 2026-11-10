/** Units of measure shared by server services and client forms. Keep this file free of server-only imports. */
export const UNITS_OF_MEASURE = ["unit", "box", "kg", "g", "l", "ml", "m", "m2", "hour"] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

/** Countable units can only be stocked and ordered in whole numbers. */
export const COUNTABLE_UNITS: ReadonlySet<UnitOfMeasure> = new Set<UnitOfMeasure>(["unit", "box"]);

export function isCountableUnit(unit: UnitOfMeasure): boolean {
  return COUNTABLE_UNITS.has(unit);
}

export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  unit: "Unit",
  box: "Box",
  kg: "Kilogram",
  g: "Gram",
  l: "Litre",
  ml: "Millilitre",
  m: "Metre",
  m2: "Square metre",
  hour: "Hour",
};
