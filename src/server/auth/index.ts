import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { ObjectId } from "mongodb";
import clientPromise from "@/server/db/client";
import { loginSchema } from "@/features/auth/schemas/auth.schema";
import { authConfig } from "@/server/auth/config";
import { issueVerificationEmail } from "@/server/auth/verification";
import type { AccountStatus } from "@/server/auth/types";
import { allowAuthAttempt, ipFromHeaders } from "@/server/security/auth-throttle";
import { maskEmail, safeEqual } from "@/server/auth/reset-token";

class BannedError extends CredentialsSignin {
  code = "banned";
}

class UnverifiedError extends CredentialsSignin {
  code = "unverified";
}

class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const normalizedEmail = email.toLowerCase().trim();
        
        const client = await clientPromise;
        const db = client.db();
        // Brute-force protection: checked before any password work, for known and unknown emails alike.
        const ip = ipFromHeaders(request.headers);
        if (!(await allowAuthAttempt(db, "login", ip, normalizedEmail, { pair: 10, account: 40, ip: 120 }))) {
          console.warn("[auth] sign-in throttled");
          throw new RateLimitedError();
        }
        let user = await db.collection("users").findOne({ email: normalizedEmail });

        const envAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
        const envAdminPassword = process.env.ADMIN_PASSWORD;

        if (!user && envAdminEmail && normalizedEmail === envAdminEmail && envAdminPassword && safeEqual(password, envAdminPassword)) {
          const hashedPassword = await bcrypt.hash(envAdminPassword, 12);
          const adminDoc = {
            name: process.env.ADMIN_NAME || "System Administrator",
            email: envAdminEmail,
            password: hashedPassword,
            role: "hr_admin",
            status: "active",
            emailVerified: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const res = await db.collection("users").insertOne(adminDoc);
          user = { _id: res.insertedId, ...adminDoc };
        }

        if (!user || !user.password) {
          console.warn(`[auth] sign-in failed for ${maskEmail(normalizedEmail)}: user not found or no password`);
          return null;
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          console.warn(`[auth] sign-in failed for ${maskEmail(normalizedEmail)}: invalid password`);
          return null;
        }

        if (user.status === "banned") {
          console.warn(`[auth] sign-in blocked for ${maskEmail(normalizedEmail)}: banned`);
          throw new BannedError();
        }

        // A new owner whose activation window ended can no longer sign in: the organization is being removed.
        if (!user.emailVerified && user.provisionalUntil instanceof Date && user.provisionalUntil <= new Date()) {
          console.warn(`[auth] sign-in blocked for ${maskEmail(normalizedEmail)}: activation window expired`);
          return null;
        }

        const status: AccountStatus =
          (user.status as AccountStatus | undefined) ??
          (user.emailVerified ? "active" : "unverified");

        console.info(`[auth] sign-in authorized for ${maskEmail(normalizedEmail)} (status=${status})`);

        if (status === "unverified") {
          const outcome = await issueVerificationEmail(
            {
              _id: user._id as ObjectId,
              email: user.email,
              name: user.name,
              status: user.status,
              emailVerified: user.emailVerified,
              verificationSentAt: user.verificationSentAt,
            },
            { force: false }
          );

          if (outcome.status === "sent") {
            console.info(`[auth] auto verification email sent to ${maskEmail(normalizedEmail)}`);
          } else if (outcome.status === "throttled") {
            console.info(
              `[auth] auto verification email skipped for ${maskEmail(normalizedEmail)} (one was sent less than 1 minute ago)`
            );
          }

          console.warn(`[auth] sign-in blocked for ${maskEmail(normalizedEmail)}: not verified`);
          // Throw so no session cookie is created for unverified users —
          // loginAction catches the "unverified" code and redirects to
          // /unverified?email=… instead.
          throw new UnverifiedError();
        }

        const employee = await db.collection("employees").findOne({ email: normalizedEmail });
        let hrRole = (employee?.role as "employee" | "manager" | "hr_admin" | undefined) ||
                     (user.role as "employee" | "manager" | "hr_admin" | undefined);

        if (!hrRole) {
          if (envAdminEmail && normalizedEmail === envAdminEmail) {
            hrRole = "hr_admin";
          } else {
            hrRole = "employee";
          }
        }

        return {
          id: user._id.toString(),
          email: user.email as string,
          name: (user.name as string) || (user.email as string).split("@")[0],
          status,
          emailVerified: (user.emailVerified as Date | null) ?? null,
          role: hrRole,
          forcePasswordReset: Boolean(user.forcePasswordReset),
        };
      },
    }),
  ],
});
