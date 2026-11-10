/**
 * Progressive profile completion. Optional fields never block anything; the score only explains
 * what is missing and links to the place to add it.
 */
export type CompletionItem = { key: string; label: string; why: string; done: boolean; href: string };
export type Completion = { percent: number; items: CompletionItem[]; missing: CompletionItem[] };

const filled = (value: unknown) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;

function score(items: CompletionItem[]): Completion {
  const done = items.filter((item) => item.done).length;
  return { percent: Math.round((done / items.length) * 100), items, missing: items.filter((item) => !item.done) };
}

export type OrganizationProfileFields = Record<string, unknown> & {
  name?: unknown;
  website?: unknown;
  industry?: unknown;
  size?: unknown;
  primaryInterest?: unknown;
  country?: unknown;
  address?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  currency?: unknown;
};

export function organizationCompletion(org: OrganizationProfileFields, orgId: string): Completion {
  const href = `/organization/${orgId}#profile`;
  return score([
    { key: "name", label: "Organization name", why: "Shown to your team and on documents.", done: filled(org.name), href },
    { key: "currency", label: "Currency", why: "Used by Finance and reports.", done: filled(org.currency), href },
    { key: "industry", label: "Industry", why: "Helps us suggest the right applications and guides.", done: filled(org.industry), href },
    { key: "size", label: "Company size", why: "Tailors onboarding to your team.", done: filled(org.size), href },
    { key: "primaryInterest", label: "Primary business interest", why: "Highlights the most relevant workflows first.", done: filled(org.primaryInterest), href },
    { key: "website", label: "Website", why: "Completes your organization identity.", done: filled(org.website), href },
    { key: "country", label: "Country", why: "Sets regional defaults.", done: filled(org.country), href },
    { key: "address", label: "Address", why: "Used on invoices and official documents.", done: filled(org.address), href },
    { key: "contact", label: "Contact email and phone", why: "Lets customers and AnOps reach the right person.", done: filled(org.contactEmail) && filled(org.contactPhone), href },
  ]);
}

export type UserProfileFields = Record<string, unknown> & { firstName?: unknown; lastName?: unknown; phone?: unknown; jobTitle?: unknown; language?: unknown; emailVerified?: unknown };

export function userCompletion(user: UserProfileFields): Completion {
  const href = "/profile";
  return score([
    { key: "name", label: "First and last name", why: "How colleagues find and recognise you.", done: filled(user.firstName) && filled(user.lastName), href },
    { key: "email", label: "Confirmed email", why: "Required to recover your account.", done: Boolean(user.emailVerified), href },
    { key: "phone", label: "Phone number", why: "For urgent security contact.", done: filled(user.phone), href },
    { key: "jobTitle", label: "Position", why: "Shown to your team.", done: filled(user.jobTitle), href },
    { key: "language", label: "Preferred language", why: "Used for emails and the interface.", done: filled(user.language), href },
  ]);
}
