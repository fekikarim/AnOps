/**
 * Pure HR date and calculation utility functions
 */

export function calculateBusinessDays(
  startDateStr: string,
  endDateStr: string,
  publicHolidayDates: string[] = []
): number {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    return 0;
  }

  const holidaySet = new Set(publicHolidayDates);
  let count = 0;
  const cur = new Date(start);

  while (cur <= end) {
    const day = cur.getDay();
    const dateStr = formatDateYMD(cur);
    if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  // A period with no working day (a weekend, a public holiday) is zero days, never rounded up to one.
  return count;
}

export function calculateLeaveDays(
  startDateStr: string,
  endDateStr: string,
  publicHolidayDates: string[] = [],
  halfDayOption?: "morning" | "afternoon"
): number {
  if (halfDayOption && startDateStr === endDateStr) {
    // Half a day only when that day is a working day.
    return calculateBusinessDays(startDateStr, endDateStr, publicHolidayDates) > 0 ? 0.5 : 0;
  }
  return calculateBusinessDays(startDateStr, endDateStr, publicHolidayDates);
}

export function calculateAge(dobStr?: string, asOfDate: Date = new Date()): number | null {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;

  let age = asOfDate.getFullYear() - dob.getFullYear();
  const m = asOfDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOfDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function getAgeCategory(
  dobStr?: string,
  asOfDate: Date = new Date()
): "adult" | "young_adult" | "under_18" {
  const age = calculateAge(dobStr, asOfDate);
  if (age === null) return "adult"; // default to standard adult if missing
  if (age < 18) return "under_18";
  if (age <= 20) return "young_adult"; // 18-20 inclusive
  return "adult";
}

/**
 * The date on which `workingDays` working days starting at `startDate` are complete,
 * skipping weekends and the given holidays. Returns `startDate` itself for invalid input.
 */
export function endDateForWorkingDays(startDate: string, workingDays: number, holidayDates: string[] = []): string {
  const day = new Date(`${startDate}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || workingDays < 1) return startDate;
  let counted = 0;
  let current = startDate;
  while (counted < workingDays) {
    current = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidayDates.includes(current)) counted += 1;
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return current;
}

export function formatDateYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateNetSalary(
  baseSalary: number,
  unpaidLeaveDays: number,
  workingDaysInMonth = 22
) {
  const dailyRate = Math.round((baseSalary / workingDaysInMonth) * 100) / 100;
  const deduction = Math.round((dailyRate * unpaidLeaveDays) * 100) / 100;
  const netSalary = Math.max(0, Math.round((baseSalary - deduction) * 100) / 100);

  return {
    dailyRate,
    deduction,
    netSalary,
  };
}
