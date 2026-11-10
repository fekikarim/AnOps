export type CompanyRole = "owner" | "admin" | "manager" | "employee";

export type Company = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  currency: string;
  industry?: string;
  logoUrl?: string;
  /** "pending" until the owner confirms the activation email; legacy companies have no value (active). */
  activationStatus?: "pending" | "active";
  activationDeadline?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CompanyMember = {
  id: string;
  companyId: string;
  userId: string;
  role: CompanyRole;
  status: "active" | "invited" | "suspended";
  userEmail?: string;
  userName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateCompanyInput = {
  name: string;
  currency?: string;
  industry?: string;
};
