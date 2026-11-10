import { z } from "zod";
import { MAX_TRIAL_APPS } from "@/shared/domain/plans";

export const ORGANIZATION_CURRENCIES = ["TND", "EUR", "USD", "GBP"] as const;

const email = z.string().trim().toLowerCase().min(1, "Email is required").max(254).email("Enter a valid email address");
// Same rules as the existing account registration: registration is not weakened.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");
const personName = (label: string) => z.string().trim().min(1, `${label} is required`).max(60, `${label} is too long`);
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ().-]{6,19}$/, "Enter a valid phone number, for example +216 20 123 456");

export const registrationSchema = z
  .object({
    firstName: personName("First name"),
    lastName: personName("Last name"),
    organizationName: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80, "Organization name is too long"),
    email,
    phone: phoneSchema,
    currency: z.enum(ORGANIZATION_CURRENCIES, { message: "Choose a currency" }),
    password,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    acceptTerms: z.literal(true, { message: "Please accept the Terms of Use and Privacy Policy" }),
    apps: z.array(z.string()).min(1, "Choose at least one application").max(MAX_TRIAL_APPS),
  })
  .refine((data) => data.password === data.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export type RegistrationInput = z.infer<typeof registrationSchema>;

export const invitationRoleSchema = z.enum(["admin", "manager", "employee"]);

export const invitationBatchSchema = z.object({
  invitations: z
    .array(z.object({ email, role: invitationRoleSchema }))
    .min(1, "Add at least one email address")
    .max(20, "You can send up to 20 invitations at once"),
});

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1),
    firstName: personName("First name"),
    lastName: personName("Last name"),
    password,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

/**
 * Free text that names something (a position, an industry): optional, 2+ characters, must contain a letter
 * (so "00" or "---" are rejected) and only ordinary punctuation. Accents and non-Latin scripts are allowed.
 */
const optionalLabel = (what: string, max = 80) =>
  z
    .string()
    .trim()
    .max(max, `${what} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || v.length >= 2, `${what} must be at least 2 characters`)
    .refine((v) => v === null || /\p{L}/u.test(v), `${what} must contain letters, not only numbers or symbols`)
    .refine((v) => v === null || /^[\p{L}\p{N}\s.,'’&()/+\-]+$/u.test(v), `${what} contains characters that are not allowed`);

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const ORGANIZATION_SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;
export const BUSINESS_INTERESTS = ["operations", "finance", "people", "sales-marketing", "manufacturing", "ai-automation"] as const;

export const organizationProfileSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters").max(80),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter a full website address starting with https://"),
  industry: optionalLabel("Industry"),
  size: z.enum(ORGANIZATION_SIZES).nullable().optional().transform((v) => v ?? null),
  primaryInterest: z.enum(BUSINESS_INTERESTS).nullable().optional().transform((v) => v ?? null),
  country: optionalText(80),
  address: optionalText(240),
  contactEmail: z.union([email, z.literal("")]).optional().transform((v) => (v ? v : null)),
  contactPhone: z.union([phoneSchema, z.literal("")]).optional().transform((v) => (v ? v : null)),
  currency: z.enum(ORGANIZATION_CURRENCIES),
});

export const userProfileSchema = z.object({
  firstName: personName("First name"),
  lastName: personName("Last name"),
  phone: z.union([phoneSchema, z.literal("")]).optional().transform((v) => (v ? v : null)),
  jobTitle: optionalLabel("Position"),
  language: z.enum(["en", "fr"]),
  notifications: z.object({ product: z.boolean(), billing: z.boolean(), security: z.boolean() }),
});

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password"), password, confirmPassword: z.string().min(1) })
  .refine((data) => data.password === data.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });
