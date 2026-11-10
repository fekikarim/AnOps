import "server-only";
import { env } from "@/config/env";

/**
 * SMTP marketing configuration.
 *
 * It deliberately reuses the same Gmail/SMTP variables as authentication mail
 * (`EMAIL_SERVER_*`, `EMAIL_FROM`) so there is exactly one set of credentials in
 * the deployment. Marketing policy lives here; authentication mail never imports
 * this module.
 */
export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  /** Full From header, for example `AnOps <news@example.com>`. */
  from: string;
  /** Bare address extracted from `from`, used for the Message-ID domain. */
  fromAddress: string;
  sendAllowlist: string[] | null;
};

export type SmtpState =
  | { configured: true; config: SmtpConfig }
  | { configured: false; missing: string[]; reason: string };

export type SmtpEnvInput = {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
  sendAllowlist?: string;
};

const EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_RE = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * Pragmatic single-mailbox validation. Display names are accepted, but the
 * address itself must be a bare domain-qualified address with no whitespace,
 * comma, control character or header-injection character.
 */
export function isValidEmailAddress(value: string): boolean {
  const address = value.trim();
  if (address.length === 0 || address.length > 254) return false;
  if (/[\s\r\n,;<>]/.test(address)) return false;
  const at = address.lastIndexOf("@");
  if (at <= 0 || at !== address.indexOf("@")) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (local.length > 64 || !EMAIL_LOCAL_RE.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return EMAIL_DOMAIN_RE.test(domain);
}

/** Extracts the bare address from `Name <address>` or returns the input when it is already bare. */
export function mailboxAddress(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || /[\r\n]/.test(value)) return null;
  const angle = /<([^<>]+)>\s*$/.exec(value);
  const candidate = (angle ? angle[1] : value).trim();
  return isValidEmailAddress(candidate) ? candidate.toLowerCase() : null;
}

export function parseAllowlist(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

/** Pure parser so missing and malformed settings can be tested without touching the environment. */
export function parseSmtpState(input: SmtpEnvInput): SmtpState {
  const host = input.host?.trim() ?? "";
  const from = input.from?.trim() ?? "";
  const missing: string[] = [];

  if (host === "") missing.push("EMAIL_SERVER_HOST");
  else if (host.includes("://") || /\s/.test(host)) missing.push("EMAIL_SERVER_HOST (must be a hostname)");

  const port = input.port ?? 587;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    missing.push("EMAIL_SERVER_PORT (must be a valid port)");
  }

  if (from === "") missing.push("EMAIL_FROM");
  const fromAddress = from === "" ? null : mailboxAddress(from);
  if (from !== "" && !fromAddress) missing.push("EMAIL_FROM (must contain a valid address)");

  const user = input.user?.trim() ?? "";
  const password = input.password ?? "";
  if (user !== "" && password === "") missing.push("EMAIL_SERVER_PASSWORD");
  if (user === "" && password !== "") missing.push("EMAIL_SERVER_USER");

  if (missing.length > 0 || !fromAddress) {
    return {
      configured: false,
      missing,
      reason: "Marketing email is unavailable until the SMTP settings are complete and valid.",
    };
  }

  return {
    configured: true,
    config: {
      host,
      port,
      secure: input.secure ?? false,
      user: user === "" ? null : user,
      password: password === "" ? null : password,
      from,
      fromAddress,
      sendAllowlist: parseAllowlist(input.sendAllowlist),
    },
  };
}

export function getSmtpState(): SmtpState {
  return parseSmtpState({
    host: env.EMAIL_SERVER_HOST,
    port: env.EMAIL_SERVER_PORT,
    secure: env.EMAIL_SERVER_SECURE,
    user: env.EMAIL_SERVER_USER,
    password: env.EMAIL_SERVER_PASSWORD,
    from: env.EMAIL_FROM,
    sendAllowlist: env.MARKETING_SEND_ALLOWLIST,
  });
}
