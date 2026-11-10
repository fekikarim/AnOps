/**
 * Fixed-point arithmetic for inventory quantities and money.
 *
 * - Quantities are stored as integer "micro-units" (1 unit = 1_000_000).
 * - Money is stored as integer "milli-units" (1 currency unit = 1_000), which
 *   covers the 3-decimal convention of TND as well as 2-decimal currencies.
 *
 * Floating-point numbers are never used for stored or summed values. Multiplication
 * uses BigInt and rounds half away from zero.
 */

export const QTY_SCALE = 1_000_000;
export const MONEY_SCALE = 1_000;

/** Largest accepted quantity, in whole units (before scaling). */
export const MAX_QTY_UNITS = 1_000_000;
/** Largest accepted unit price / amount, in whole currency units. */
export const MAX_MONEY_UNITS = 1_000_000;
export const MAX_BASIS_POINTS = 10_000;

const QTY_PATTERN = /^\d{1,6}(\.\d{1,6})?$/;
const MONEY_PATTERN = /^\d{1,6}(\.\d{1,3})?$/;

export class FixedPointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedPointError";
  }
}

function parseScaled(
  input: string,
  pattern: RegExp,
  scale: number,
  maxUnits: number,
  label: string
): number {
  const trimmed = input.trim();
  if (!pattern.test(trimmed)) {
    throw new FixedPointError(`${label} must be a non-negative decimal number`);
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  const fractionDigits = Math.log10(scale);
  const scaled = Number(intPart) * scale + Number(fracPart.padEnd(fractionDigits, "0"));
  if (Number(intPart) > maxUnits || scaled > maxUnits * scale) {
    throw new FixedPointError(`${label} exceeds the maximum of ${maxUnits}`);
  }
  return scaled;
}

/** Parses a user-entered quantity such as "12.5" into integer micro-units. */
export function parseQuantity(input: string): number {
  return parseScaled(input, QTY_PATTERN, QTY_SCALE, MAX_QTY_UNITS, "Quantity");
}

/** Parses a user-entered money amount such as "3.250" into integer milli-units. */
export function parseMoney(input: string): number {
  return parseScaled(input, MONEY_PATTERN, MONEY_SCALE, MAX_MONEY_UNITS, "Amount");
}

function formatScaled(value: number, scale: number, decimals: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new FixedPointError("Stored value is not a safe integer");
  }
  const negative = value < 0;
  const abs = Math.abs(value);
  const intPart = Math.floor(abs / scale);
  const fracPart = abs % scale;
  const fracDigits = Math.log10(scale);
  const frac = fracPart.toString().padStart(fracDigits, "0").slice(0, decimals);
  const body = decimals > 0 ? `${intPart}.${frac}` : `${intPart}`;
  return negative && abs !== 0 ? `-${body}` : body;
}

/** Formats micro-units as a plain decimal string with the given decimal places. */
export function formatQuantity(microUnits: number, decimals = 3): string {
  return formatScaled(microUnits, QTY_SCALE, decimals);
}

/** Formats milli-units as a plain decimal string with the given decimal places. */
export function formatMoneyAmount(milliUnits: number, decimals = 3): string {
  return formatScaled(milliUnits, MONEY_SCALE, decimals);
}

/** Returns true when a quantity is a whole number of units. */
export function isWholeQuantity(microUnits: number): boolean {
  return microUnits % QTY_SCALE === 0;
}

/**
 * Line amount = quantity x unit price, returned in milli-units and rounded half away from zero.
 * quantityMicro x priceMilli / QTY_SCALE.
 */
export function multiplyQuantityByPrice(quantityMicro: number, priceMilli: number): number {
  const product = BigInt(quantityMicro) * BigInt(priceMilli);
  const quotient = (product + BigInt(QTY_SCALE / 2)) / BigInt(QTY_SCALE);
  return toSafeNumber(quotient, "Line amount");
}

/** Applies a basis-point rate (1 bp = 0.01%) to an amount in milli-units, rounding half away from zero. */
export function applyBasisPoints(amountMilli: number, basisPoints: number): number {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_BASIS_POINTS) {
    throw new FixedPointError("Tax rate must be between 0 and 100%");
  }
  const product = BigInt(amountMilli) * BigInt(basisPoints);
  const quotient = (product + BigInt(5000)) / BigInt(10000);
  return toSafeNumber(quotient, "Tax amount");
}

/** Adds integers with an overflow guard, for totals. */
export function sumSafe(values: number[], label: string): number {
  let total = BigInt(0);
  for (const value of values) {
    total += BigInt(value);
  }
  return toSafeNumber(total, label);
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new FixedPointError(`${label} is outside the supported range`);
  }
  return Number(value);
}

/** Parses a percentage typed by a user ("19", "7.5") into basis points (1900, 750). */
export function parsePercentToBasisPoints(input: string): number {
  const trimmed = input.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(trimmed)) {
    throw new FixedPointError("Tax rate must be a percentage such as 19 or 7.5");
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  const basisPoints = Number(intPart) * 100 + Number(fracPart.padEnd(2, "0"));
  if (basisPoints > MAX_BASIS_POINTS) {
    throw new FixedPointError("Tax rate cannot exceed 100%");
  }
  return basisPoints;
}

/** Formats basis points as a percentage string such as "19" or "7.5". */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return `${whole}`;
  return `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

/** Multiplies two micro-unit quantities and returns micro-units: (a x b) / QTY_SCALE, rounded half away from zero. */
export function scaleQuantity(quantityMicro: number, factorMicro: number): number {
  const product = BigInt(quantityMicro) * BigInt(factorMicro);
  const quotient = (product + BigInt(QTY_SCALE / 2)) / BigInt(QTY_SCALE);
  return toSafeNumber(quotient, "Scaled quantity");
}
