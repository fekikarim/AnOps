import type { Metadata } from "next";
import { LegalDocument } from "@/shared/components/portal/legal-document";
import { privacyPolicy } from "@/shared/config/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How AnOps collects, uses, shares and protects personal information on its website and platform, and the rights you have.",
};

export default function PrivacyPage() {
  return <LegalDocument doc={privacyPolicy} related={{ label: "Read the Terms of Use", href: "/terms" }} />;
}
