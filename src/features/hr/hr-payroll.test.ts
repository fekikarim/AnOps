/**
 * Unit verification for HR & Payroll logic and mathematical formulas
 * Can be run via tsx or node:
 *   npx tsx src/features/hr/hr-payroll.test.ts
 */

import { calculateBusinessDays, calculateNetSalary } from "./utils/date-utils";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log("=== Running AnOps HR & Payroll Module Tests ===");

  // Test 1: Weekend exclusion in business days calculation
  console.log("Test 1: Business days calculation excludes Saturday and Sunday...");
  // Mon 2026-10-05 to Fri 2026-10-09 (5 working days)
  const fiveDays = calculateBusinessDays("2026-10-05", "2026-10-09");
  assert(fiveDays === 5, `Expected 5 days, got ${fiveDays}`);

  // Fri 2026-10-09 to Mon 2026-10-12 (Fri, Sat, Sun, Mon = 2 working days)
  const weekendSpan = calculateBusinessDays("2026-10-09", "2026-10-12");
  assert(weekendSpan === 2, `Expected 2 working days, got ${weekendSpan}`);

  // Sat 2026-10-10 to Sun 2026-10-11
  const weekendOnly = calculateBusinessDays("2026-10-10", "2026-10-11");
  assert(weekendOnly === 0, `A weekend-only period has no working days`);
  console.log("  ✓ Business days calculation passed");

  // Test 2: Standard net salary with zero unpaid leave
  console.log("Test 2: Payroll calculation with 0 unpaid leave days...");
  const zeroUnpaid = calculateNetSalary(4200, 0, 22);
  assert(zeroUnpaid.dailyRate === 190.91, `Expected daily rate 190.91, got ${zeroUnpaid.dailyRate}`);
  assert(zeroUnpaid.deduction === 0, `Expected deduction 0, got ${zeroUnpaid.deduction}`);
  assert(zeroUnpaid.netSalary === 4200, `Expected net salary 4200, got ${zeroUnpaid.netSalary}`);
  console.log("  ✓ Zero unpaid leave passed (Net = 4200 TND)");

  // Test 3: Payroll calculation with 2 unpaid leave days
  console.log("Test 3: Payroll calculation with 2 unpaid leave days...");
  const twoUnpaid = calculateNetSalary(4200, 2, 22);
  // dailyRate = 190.91, deduction = 190.91 * 2 = 381.82, net = 4200 - 381.82 = 3818.18
  assert(twoUnpaid.deduction === 381.82, `Expected deduction 381.82, got ${twoUnpaid.deduction}`);
  assert(twoUnpaid.netSalary === 3818.18, `Expected net salary 3818.18, got ${twoUnpaid.netSalary}`);
  console.log("  ✓ 2 unpaid days deduction passed (Deduction = 381.82 TND, Net = 3818.18 TND)");

  // Test 4: Payroll calculation with full month unpaid leave (22 days)
  console.log("Test 4: Payroll calculation with full month unpaid (22 days)...");
  const fullUnpaid = calculateNetSalary(4200, 22, 22);
  assert(Math.abs(fullUnpaid.deduction - 4200) < 1, "Deduction matches base");
  assert(fullUnpaid.netSalary === 0, `Net salary should clamp to 0, got ${fullUnpaid.netSalary}`);
  console.log("  ✓ Full month unpaid passed (Net clamped to 0 TND)");

  // Test 5: Leave balance logic: allowance minus used paid days
  console.log("Test 5: Leave balance math...");
  const allowance = 25;
  const usedPaidDays = 5;
  const remaining = Math.max(0, allowance - usedPaidDays);
  assert(remaining === 20, `Remaining should be 20, got ${remaining}`);
  console.log("  ✓ Leave balance math passed");

  console.log("\n=== ALL HR & PAYROLL UNIT TESTS PASSED SUCCESSFULLY! ===");
}

runTests();
