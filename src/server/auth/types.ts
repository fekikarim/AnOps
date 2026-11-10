import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";

export type AccountStatus = "active" | "unverified" | "banned";
export type EmployeeRole = "employee" | "manager" | "hr_admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      status: AccountStatus;
      emailVerified: Date | null;
      role: EmployeeRole;
      forcePasswordReset: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    status?: AccountStatus;
    emailVerified?: Date | null;
    role?: EmployeeRole;
    forcePasswordReset?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    status?: AccountStatus;
    emailVerified?: Date | null;
    role?: EmployeeRole;
    forcePasswordReset?: boolean;
  }
}

export type { JWT };
