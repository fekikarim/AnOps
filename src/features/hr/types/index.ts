export type Department = {
  id: string;
  name: string;
  description?: string;
  employeeCount?: number;
  createdAt?: string;
};

export type JobTitle = {
  id: string;
  title: string;
  departmentId?: string;
  isPredefined: boolean;
  employeeCount?: number;
  createdAt?: string;
};

export type EmployeeRole = "employee" | "manager" | "hr_admin";
export type EmployeeStatus = "active" | "inactive";

export type Employee = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  hireDate: string;
  dateOfBirth?: string;
  baseSalary: number;
  status: EmployeeStatus;
  role: EmployeeRole;
  leaveAllowance: number;
  createdAt?: string;
  updatedAt?: string;
};

export type HRDashboardStats = {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  departmentCount: number;
  jobTitleCount: number;
  averageSalary: number;
  monthlyPayrollGross: number;
};

export type EmployeeFilterParams = {
  search?: string;
  departmentId?: string;
  status?: "all" | "active" | "inactive";
};

// ========================
// Leave / Time-off Types
// ========================

export type LeaveType =
  | "annual"
  | "sick"
  | "unpaid"
  | "maternity_paternity"
  | "bereavement"
  | "other";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled" | "taken";

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  leaveType: LeaveType;
  leaveTypeId?: string;
  isPaid: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  days: number;
  requestedDays?: number;
  approvedDays?: number;
  halfDayOption?: "morning" | "afternoon";
  supportingDocumentUrl?: string;
  cancellationReason?: string;
  reason: string;
  status: LeaveStatus;
  adminComment?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt?: string;
};

export type LeaveBalance = {
  employeeId: string;
  employeeName: string;
  year: number;
  allowance: number;       // e.g. 25 or Earned
  usedPaidDays: number;    // approved/taken paid leave days this year
  remainingDays: number;   // available days
  unpaidDaysTaken: number; // unpaid days taken (feeds payroll)
  // Extended Solde de congé fields:
  earned?: number;
  taken?: number;
  reserved?: number;
  adjustments?: number;
  available?: number;
  policySummary?: {
    name: string;
    accrualRate: number;
    annualCap: number;
    legalReference: string;
  };
};

// ==========================================
// Solde de Congé (Ledger & Policy Types)
// ==========================================

export type LeaveTypeRecord = {
  id: string;
  companyId: string;
  name: string;
  code: string; // e.g. "CP", "SICK", "EXCEPTIONAL", "UNPAID"
  isPaid: boolean;
  requiresApproval: boolean;
  requiresDocument: boolean;
  isActive: boolean;
  createdAt: string;
};

export type EmployeeCategory = "adult" | "young_adult" | "under_18";

export type LeavePolicyRecord = {
  id: string;
  companyId: string;
  name: string;
  country: string; // "TN"
  employeeCategory: EmployeeCategory;
  accrualRate: number; // e.g. 1.0, 1.5, 2.0 days per month
  accrualPeriod: "monthly";
  annualCap: number; // e.g. 15 calendar days (12 working days)
  referencePeriodType: "calendar_year";
  calculationMethod: "standard_monthly";
  roundingRule: "half_day";
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string; // YYYY-MM-DD
  legalReference: string; // "Code du Travail Art. 113-114"
  isActive: boolean;
  createdAt: string;
};

export type EmployeeLeavePolicyRecord = {
  id: string;
  companyId: string;
  employeeId: string;
  leavePolicyId: string;
  policyName?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  assignedBy?: string;
  assignedAt: string;
};

export type LeaveTransactionType =
  | "ACCRUAL"
  | "TAKEN"
  | "RESERVATION"
  | "RELEASE"
  | "ADJUSTMENT"
  | "COMPENSATION"
  | "REVERSAL";

export type LeaveTransactionRecord = {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName?: string;
  leaveTypeId?: string;
  leaveTypeCode?: string;
  transactionType: LeaveTransactionType;
  days: number; // positive or negative
  effectiveDate: string; // YYYY-MM-DD
  referenceId?: string; // e.g. leave requestId or original transactionId for reversal
  description: string;
  createdBy: string;
  createdAt: string;
};

export type PublicHolidayRecord = {
  id: string;
  companyId: string;
  name: string;
  date: string; // YYYY-MM-DD
  isHalfDay: boolean;
};

export type SoldeDeConge = {
  employeeId: string;
  employeeName: string;
  year: number;
  earned: number;
  taken: number;
  reserved: number;
  adjustments: number;
  available: number;
  unpaidDaysTaken: number;
  asOfDate?: string;
  policySummary?: {
    name: string;
    accrualRate: number;
    annualCap: number;
    legalReference: string;
  };
};

// ========================
// Attendance Types
// ========================

export type AttendanceStatus = "present" | "checked_out";

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // ISO string
  checkOut?: string; // ISO string
  hoursWorked: number;
  status: AttendanceStatus;
  createdAt: string;
};

export type TodayAttendanceSummary = {
  totalActive: number;
  presentCount: number;
  checkedOutCount: number;
  absentCount: number;
  records: AttendanceRecord[];
};

// ========================
// Payroll Types
// ========================

export type PayslipRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  departmentName: string;
  period: string; // YYYY-MM e.g. "2026-10"
  baseSalary: number;
  workingDaysInMonth: number; // default 22
  dailyRate: number;
  unpaidLeaveDays: number;
  deduction: number;
  netSalary: number;
  currency: string; // "TND"
  status: "generated" | "paid";
  generatedAt: string;
};

export type PayrollSummary = {
  period: string;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployees: number;
  payslipsGenerated: number;
};

// ========================
// AI Assistant & Policy Types
// ========================

export type HRPolicyDocument = {
  id: string;
  title: string;
  category: "leave" | "attendance" | "payroll" | "general";
  summary: string;
  content: string;
};

export type AIChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolData?: {
    type: "leave_balance" | "attendance" | "payroll_calculation" | "policy_excerpt";
    data: Record<string, unknown>;
  };
};
