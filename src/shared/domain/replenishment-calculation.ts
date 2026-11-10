import { isCountableUnit, type UnitOfMeasure } from "@/shared/domain/units";
import { QTY_SCALE } from "@/shared/lib/fixed-point";

/**
 * The replenishment arithmetic, in micro-units, shared by the server (which stores quantities) and the
 * UI (which explains them). Pure: no server-only imports, so both sides run the same code.
 *
 *   daily use     = round(consumed over the lookback ÷ lookback days)      (actual history)
 *   projected use = daily use × horizon days                              (historical average applied forward)
 *   requirement   = projected use + reorder point − on hand
 *   suggested     = max(0, requirement), rounded up to whole units for countable units
 */
export type ReplenishmentFacts = {
  unitOfMeasure: UnitOfMeasure;
  lookbackDays: number;
  horizonDays: number;
  onHandMicro: number;
  reorderPointMicro: number;
  consumedMicro: number;
  forecastDailyUsageMicro: number;
  suggestedMicro: number;
};

export function projectedUseMicro(facts: Pick<ReplenishmentFacts, "forecastDailyUsageMicro" | "horizonDays">): number {
  return facts.forecastDailyUsageMicro * facts.horizonDays;
}

export function requirementMicro(facts: ReplenishmentFacts): number {
  return projectedUseMicro(facts) + facts.reorderPointMicro - facts.onHandMicro;
}

/** A quantity as plain text with up to three decimals and no trailing zeros, for example "2.5" or "10". */
export function formatFact(micro: number): string {
  return (micro / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
}

/**
 * Deterministic statements about one suggestion. They use only the stored facts, so they are correct
 * whether or not an AI explanation exists. The projection is the historical average, not a forecast.
 */
export function calculationStatements(facts: ReplenishmentFacts): string[] {
  const unit = facts.unitOfMeasure;
  const daily = formatFact(facts.forecastDailyUsageMicro);
  const projected = formatFact(projectedUseMicro(facts));
  const reorder = formatFact(facts.reorderPointMicro);
  const onHand = formatFact(facts.onHandMicro);
  const requirement = requirementMicro(facts);
  const countable = isCountableUnit(unit);
  const roundedUp = countable && requirement % QTY_SCALE !== 0;

  return [
    facts.consumedMicro > 0
      ? `Recorded consumption: ${formatFact(facts.consumedMicro)} ${unit} in the last ${facts.lookbackDays} days, an average of ${daily} per day.`
      : `Recorded consumption: none in the last ${facts.lookbackDays} days, so projected use is 0.`,
    `Projected use over the next ${facts.horizonDays} days: ${daily} × ${facts.horizonDays} = ${projected} ${unit}. This applies the recorded average; it is not a forecast.`,
    `Reorder point ${reorder} ${unit}; on hand ${onHand} ${unit}.`,
    `Requirement: ${projected} + ${reorder} − ${onHand} = ${formatFact(requirement)} ${unit}.`,
    `Suggested quantity: ${formatFact(facts.suggestedMicro)} ${unit}${roundedUp ? ", rounded up to whole units" : ""}.`,
  ];
}
