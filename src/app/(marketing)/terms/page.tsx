import type { Metadata } from "next";
import { LegalDocument } from "@/shared/components/portal/legal-document";
import { termsOfUse } from "@/shared/config/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms that govern access to and use of the AnOps website and platform.",
};

export default function TermsPage() {
  return <LegalDocument doc={termsOfUse} related={{ label: "Read the Privacy Policy", href: "/privacy" }} />;
}
