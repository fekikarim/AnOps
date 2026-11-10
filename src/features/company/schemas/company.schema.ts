import { z } from "zod";

export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters")
    .max(80, "Company name cannot exceed 80 characters"),
  currency: z.string().trim().default("TND"),
  industry: z.string().trim().optional(),
});

export type CreateCompanySchema = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters")
    .max(80, "Company name cannot exceed 80 characters")
    .optional(),
  currency: z.string().trim().min(3).max(4).optional(),
  industry: z.string().trim().max(80).optional(),
});

export type UpdateCompanySchema = z.infer<typeof updateCompanySchema>;

export const addCompanyMemberSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").optional(),
  role: z.enum(["admin", "manager", "employee"]),
});

export type AddCompanyMemberSchema = z.infer<typeof addCompanyMemberSchema>;

export const updateCompanyMemberRoleSchema = z.object({
  role: z.enum(["admin", "manager", "employee"]),
});

export type UpdateCompanyMemberRoleSchema = z.infer<typeof updateCompanyMemberRoleSchema>;
