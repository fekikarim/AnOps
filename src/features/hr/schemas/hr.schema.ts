import { z } from "zod";

export const employeeSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(80, "Full name must be at most 80 characters"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid work email address"),
  phone: z
    .string()
    .trim()
    .max(25, "Phone number is too long")
    .optional()
    .or(z.literal("")),
  departmentId: z
    .string()
    .min(1, "Please select a department"),
  jobTitle: z
    .string()
    .trim()
    .min(2, "Job title is required")
    .max(80, "Job title is too long"),
  isCustomJobTitle: z.boolean().optional().default(false),
  hireDate: z
    .string()
    .min(1, "Hire date is required"),
  dateOfBirth: z
    .string()
    .optional()
    .or(z.literal("")),
  baseSalary: z.coerce
    .number({ message: "Base salary must be a valid number" })
    .min(0, "Base salary cannot be negative"),
  role: z.enum(["employee", "manager", "hr_admin"]).default("employee"),
  status: z.enum(["active", "inactive"]).default("active"),
  leaveAllowance: z.coerce
    .number()
    .min(0, "Leave allowance cannot be negative")
    .default(25),
});

export const jobTitleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Job title must be at least 2 characters")
    .max(80, "Job title is too long"),
  departmentId: z.string().optional(),
});

export const departmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Department name must be at least 2 characters")
    .max(60, "Department name is too long"),
  description: z.string().trim().max(250).optional(),
});

// ========================
// Leave / Time-off Schemas
// ========================

export const leaveRequestSchema = z
  .object({
    employeeId: z.string().min(1, "Employee is required"),
    leaveType: z.enum([
      "annual",
      "sick",
      "unpaid",
      "maternity_paternity",
      "bereavement",
      "other",
    ]),
    leaveTypeId: z.string().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    halfDayOption: z.enum(["morning", "afternoon"]).optional(),
    supportingDocumentUrl: z.string().optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Please provide a reason (minimum 3 characters)")
      .max(300, "Reason must be at most 300 characters"),
    isPaid: z.boolean().default(true),
  })
  .refine(
    (data) => {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      return !isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start;
    },
    {
      message: "End date must be on or after start date",
      path: ["endDate"],
    }
  );

export const leaveReviewSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
  action: z.enum(["approve", "reject"]),
  adminComment: z.string().trim().max(300, "Comment is too long").optional(),
  overrideReason: z.string().trim().max(300).optional(),
});

export const leaveAdjustmentSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  leaveTypeId: z.string().optional(),
  days: z.coerce.number().refine((n) => n !== 0, "Days cannot be zero"),
  reason: z
    .string()
    .trim()
    .min(3, "Mandatory reason must be at least 3 characters")
    .max(300, "Reason must be at most 300 characters"),
});

export const leavePolicySchema = z.object({
  name: z.string().trim().min(2, "Policy name is required"),
  employeeCategory: z.enum(["adult", "young_adult", "under_18"]),
  accrualRate: z.coerce.number().min(0).max(10),
  annualCap: z.coerce.number().min(1).max(60),
  effectiveFrom: z.string().min(1, "Effective date is required"),
  legalReference: z.string().trim().min(1, "Legal reference is required"),
});

export const publicHolidaySchema = z.object({
  name: z.string().trim().min(2, "Holiday name is required"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  isHalfDay: z.boolean().default(false),
});

// ========================
// Attendance Schemas
// ========================

export const attendancePunchSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
});

// ========================
// Payroll Schemas
// ========================

export const payrollGenerateSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be in YYYY-MM format"),
  employeeIds: z.array(z.string()).optional(),
  workingDaysInMonth: z.coerce.number().min(1).max(31).default(22),
  /** Explicitly recompute payslips already marked paid. Off by default: paid payslips are otherwise left untouched. */
  correctPaid: z.boolean().optional(),
});

// ========================
// AI Assistant Schemas
// ========================

export const aiPromptSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "Prompt cannot be empty")
    .max(1000, "Prompt cannot exceed 1000 characters"),
  employeeId: z.string().min(1, "Employee context is required"),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type JobTitleInput = z.infer<typeof jobTitleSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;
export type LeaveReviewInput = z.infer<typeof leaveReviewSchema>;
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;
export type LeavePolicyInput = z.infer<typeof leavePolicySchema>;
export type PublicHolidayInput = z.infer<typeof publicHolidaySchema>;
export type AttendancePunchInput = z.infer<typeof attendancePunchSchema>;
export type PayrollGenerateInput = z.infer<typeof payrollGenerateSchema>;
export type AIPromptInput = z.infer<typeof aiPromptSchema>;
