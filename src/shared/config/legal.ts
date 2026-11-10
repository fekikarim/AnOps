/**
 * Privacy Policy and Terms of Use.
 * Every factual statement mirrors current product behaviour (see src/server/auth, src/server/ai, src/server/marketing,
 * src/server/finance, src/app/layout.tsx). Operator identity, postal address and a dedicated privacy contact are not
 * available yet and are intentionally not invented: requests go through the contact page.
 * Update `updated` whenever the text changes, and have both documents reviewed by legal counsel before commercial launch.
 */
export type LegalItem = { term?: string; text: string };

export type LegalSection = {
  id: string;
  title: string;
  body?: string[];
  items?: LegalItem[];
  table?: { head: string[]; rows: string[][] };
  after?: string[];
};

export type LegalDoc = {
  title: string;
  icon: string;
  intro: string;
  updated: string;
  minutes: number;
  summary: string[];
  sections: LegalSection[];
};

export const privacyPolicy: LegalDoc = {
  title: "Privacy Policy",
  icon: "wired-lineal-1335-qr-code-hover-pinch.webp",
  intro:
    "This policy explains what personal information AnOps processes when you visit our website or use the AnOps platform, why we process it, who we share it with and the choices and rights you have.",
  updated: "2026-11-09",
  minutes: 9,
  summary: [
    "We collect what we need to run your account and the applications your company uses.",
    "Business data in a company workspace belongs to that company; we process it on its behalf.",
    "We do not sell personal information and we do not use advertising or tracking cookies.",
    "AI features send only what a request needs to our AI providers, and every change requires a person's confirmation.",
    "AI conversations are private to their author and deleted after a retention period set by the company (90 days by default).",
    "You can ask to access, correct or delete your information at any time.",
  ],
  sections: [
    {
      id: "scope",
      title: "Scope and roles",
      body: [
        "This policy applies to the AnOps public website and to the AnOps platform, including its applications (AnOps AI, Company, HR & Payroll, CRM, Sales, Finance, Inventory, Purchasing, Manufacturing, Marketing, and Blogs & Community) and the installable web app.",
        "For account information and the operation of the website, AnOps decides how personal information is processed and acts as the controller.",
        "For the business records that a company enters into its workspace (for example employees, customers, suppliers, marketing contacts, invoices or receipts), the company that owns the workspace is the controller and AnOps processes that information on its behalf and on its instructions. If you are an employee, customer or contact of a company that uses AnOps, please address requests about that information to the company first.",
      ],
    },
    {
      id: "information-we-collect",
      title: "Information we collect",
      items: [
        { term: "Account information", text: "your name, email address and password. Passwords are stored only as a salted cryptographic hash and are never visible to us." },
        { term: "Company and membership information", text: "the companies you create or join, their settings (such as name, industry and currency) and the role you hold in each one." },
        { term: "Workspace content", text: "the records you and your colleagues create in the applications, such as employee records, leave and attendance, payroll information, products and stock movements, suppliers and orders, invoices, payments and expenses, marketing contacts and consent records, blog articles, forum topics, comments and chat messages." },
        { term: "Files you upload", text: "such as receipt photos or PDFs, which are stored with a fingerprint used to detect duplicates." },
        { term: "AI usage", text: "your conversations with AnOps AI, the proposals it prepares, your confirmations, and the number of tokens used for budgets and limits." },
        { term: "Activity and audit records", text: "records of consequential actions (who changed what, and when) so that companies can review and account for changes." },
        { term: "Connected services", text: "when a company connects an integration, the information needed to operate it, for example a linked Telegram chat identifier or a Facebook Page access token, which is stored encrypted." },
        { term: "Technical information", text: "information our servers need to deliver and secure the service, such as request metadata in server logs, and the cookies and local storage described in section 8." },
      ],
      after: ["We do not ask for, and you should not enter, special categories of information unless it is necessary for a legitimate business purpose of your company and permitted by law."],
    },
    {
      id: "how-we-use",
      title: "How we use information",
      items: [
        { text: "to create and secure your account, verify your email address and let you reset your password;" },
        { text: "to provide the applications, keep each company's data isolated and enforce the roles and permissions set by your company;" },
        { text: "to provide AI features you or your company choose to use, and to apply usage limits;" },
        { text: "to send service emails, such as verification and password-reset messages, and messages your company sends through the Marketing application;" },
        { text: "to maintain audit records, detect and prevent abuse, and investigate security incidents;" },
        { text: "to answer your questions and requests, and to improve the reliability and usability of the service;" },
        { text: "to comply with legal obligations and to establish, exercise or defend legal claims." },
      ],
      after: [
        "We process personal information on the basis of the contract with you or your company, our legitimate interests in operating a secure and reliable service, your consent where it is required, and compliance with legal obligations.",
      ],
    },
    {
      id: "ai-features",
      title: "AI features",
      body: [
        "When you use an AI feature, such as the AnOps AI Command Center, the HR assistant, the Finance Copilot, receipt scanning, the marketing copywriter or article summaries, the text of your request and the records needed to answer it are sent to an AI provider to generate a response. We currently use Groq, OpenRouter and Google (Gemini), with automatic fallback between them.",
        "AI access is controlled by your company. An owner decides who may use AI and on which modules and operations, always within the person's existing permissions. AI prepares proposals; nothing changes in your workspace until an authorized person confirms it.",
        "Conversations are private to the person who had them. A company can review transcripts only through a separate, explicit and audited permission, and the affected employee is notified. Some AI features withhold names or other details from the model where they are not needed.",
        "AI output can be inaccurate. Please review it before relying on it.",
      ],
    },
    {
      id: "sharing",
      title: "How we share information",
      body: ["We do not sell personal information and we do not share it for advertising. We share it only as follows:"],
      items: [
        { term: "Within your company", text: "members of a company see workspace records according to the roles and permissions the company sets." },
        { term: "Service providers", text: "providers that host our infrastructure and database, deliver email (for example through an SMTP provider or Brevo), deliver SMS, and provide AI models. They process information only to provide their service to us." },
        { term: "Integrations your company enables", text: "for example Telegram or Meta (Facebook Pages). Information sent to those services is also governed by their own terms and privacy policies." },
        { term: "Legal reasons", text: "when required by law, court order or a competent authority, or to protect the rights, safety and security of users, the public or AnOps." },
        { term: "Business changes", text: "in connection with a merger, acquisition or sale of assets, subject to equivalent protection of your information." },
      ],
    },
    {
      id: "marketing-communications",
      title: "Marketing messages sent with AnOps",
      body: [
        "Companies can use the Marketing application to send email, SMS and Telegram messages to their own contacts. The company sending the message is responsible for having a valid basis, such as consent, for contacting each person.",
        "AnOps records consent by channel and purpose, checks it again at the moment each message is sent, and honours unsubscribe requests made through the signed link included in messages. If you received a message from a company using AnOps, you can unsubscribe through that link or contact the company directly.",
      ],
    },
    {
      id: "retention",
      title: "How long we keep information",
      items: [
        { term: "Account information", text: "for as long as your account exists, then deleted or anonymised within a reasonable period, except where we must keep it longer by law." },
        { term: "Workspace content", text: "for as long as the company keeps it in its workspace, or as instructed by the company." },
        { term: "AI conversations", text: "for the retention period set by the company, 90 days by default. People can delete their own conversations at any time." },
        { term: "Audit records and logs", text: "for as long as needed for security, accountability and legal purposes." },
      ],
    },
    {
      id: "cookies",
      title: "Cookies and local storage",
      body: [
        "We use only what is necessary for the website and platform to work. We do not use advertising cookies or third-party analytics trackers.",
      ],
      table: {
        head: ["Name", "Type", "Purpose"],
        rows: [
          ["authjs.session-token", "Cookie, strictly necessary", "Keeps you signed in securely."],
          ["authjs.csrf-token, authjs.callback-url", "Cookie, strictly necessary", "Protects sign-in forms and returns you to the right page."],
          ["anops_active_company_id", "Cookie, strictly necessary", "Remembers which of your companies is active."],
          ["anops:theme", "Local storage, preference", "Remembers whether you chose the light or dark theme."],
          ["Offline storage", "Browser storage, functional", "Lets the installable app keep working briefly without a connection."],
        ],
      },
      after: ["You can delete cookies and site data in your browser settings. Blocking strictly necessary cookies will prevent you from signing in."],
    },
    {
      id: "security",
      title: "Security",
      body: [
        "We protect information with measures appropriate to its sensitivity, including encrypted connections, hashed passwords, encrypted storage of integration tokens, server-side permission checks on every request, strict separation between companies, sensitive-data permissions for HR and salary information, and audit records of consequential actions.",
        "No system is perfectly secure. If we become aware of a breach affecting your personal information, we will notify you and the competent authorities where required by law.",
      ],
    },
    {
      id: "international-transfers",
      title: "International transfers",
      body: [
        "Our service providers, including AI providers, may process information in countries other than your own. Where we transfer personal information internationally, we rely on safeguards recognised by applicable data protection law.",
      ],
    },
    {
      id: "your-rights",
      title: "Your rights",
      body: [
        "Depending on the law that applies to you, you may have the right to access the personal information we hold about you, have it corrected, have it deleted, restrict or object to certain processing, receive a copy in a portable format, and withdraw consent at any time without affecting earlier processing.",
        "To make a request, contact us through the contact page. For information held in a company's workspace, we will refer your request to that company or help it respond. We may need to verify your identity before acting on a request. You also have the right to lodge a complaint with your data protection authority.",
      ],
    },
    {
      id: "children",
      title: "Children",
      body: ["AnOps is a business service and is not directed to children. We do not knowingly collect personal information from children, and accounts must be created by adults acting for a business."],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      body: [
        "We may update this policy as the service evolves. We will change the “Last updated” date at the top and, for significant changes, notify you through the platform or by email before they take effect.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      body: ["For privacy questions or to exercise your rights, contact us through the contact page and mention “Privacy” in your message."],
    },
  ],
};

export const termsOfUse: LegalDoc = {
  title: "Terms of Use",
  icon: "wired-lineal-728-notebook-pen-hover-pinch.webp",
  intro:
    "These terms govern your access to and use of the AnOps website and platform. Please read them carefully. By creating an account or using AnOps, you agree to them.",
  updated: "2026-11-09",
  minutes: 11,
  summary: [
    "You must provide accurate information and keep your credentials secure.",
    "Your company owns its data; we use it only to provide and secure the service.",
    "AI outputs are suggestions that a person must review and confirm.",
    "Paid plan prices and billing terms will be published before any charge applies.",
    "Do not misuse the service, including sending messages without valid consent.",
    "Features marked Coming soon are not yet available and may change.",
  ],
  sections: [
    {
      id: "acceptance",
      title: "Acceptance of these terms",
      body: [
        "These Terms of Use (the “Terms”) form an agreement between you and AnOps. If you use AnOps on behalf of a company or other organisation, you confirm that you are authorised to accept these Terms on its behalf, and “you” includes that organisation.",
        "If you do not agree to these Terms, do not use AnOps. Our Privacy Policy explains how we handle personal information and forms part of these Terms.",
      ],
    },
    {
      id: "definitions",
      title: "Definitions",
      items: [
        { term: "Platform", text: "the AnOps web application, its applications, the installable web app and related services." },
        { term: "Company", text: "a workspace created in the Platform, with its own settings, members and data." },
        { term: "Member", text: "a person who belongs to a Company with a role of owner, admin, manager or employee." },
        { term: "Customer Data", text: "all information that a Company or its Members enter, upload or generate in the Platform." },
        { term: "AI Features", text: "features that use artificial intelligence models to answer questions, prepare proposals or generate content." },
      ],
    },
    {
      id: "accounts",
      title: "Accounts",
      items: [
        { text: "You must be an adult and use AnOps for business or professional purposes." },
        { text: "You must provide accurate information, confirm your email address and keep your account details up to date." },
        { text: "You are responsible for keeping your password confidential and for activity under your account. Tell us promptly if you suspect unauthorised access." },
        { text: "One account belongs to one person. Do not share accounts." },
      ],
    },
    {
      id: "companies-and-roles",
      title: "Companies, roles and permissions",
      body: [
        "The owner of a Company controls its settings and decides who may join it and with which role. Owners and administrators are responsible for granting access appropriately, including access to sensitive information and to AI Features, and for removing access when it is no longer needed.",
        "Each Company is isolated from the others. A person may belong to several Companies with a different role in each.",
      ],
    },
    {
      id: "plans-and-billing",
      title: "Plans, pricing and billing",
      items: [
        { term: "Free", text: "one Company and one application." },
        { term: "Standard", text: "one Company and all applications." },
        { term: "Pro", text: "multiple Companies and all applications." },
        { term: "Ultra", text: "multiple Companies and all applications, with advanced AI capabilities and early access to new AI features." },
        { term: "Custom", text: "a tailored arrangement agreed in writing." },
      ],
      after: [
        "Prices and billing terms for paid plans will be published on the pricing page and presented to you before you subscribe. No charge will apply without your acceptance of those terms. We may change plans or prices for future billing periods with reasonable prior notice.",
        "Usage limits may apply, for example to AI token consumption, to protect the service and keep costs predictable.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: ["You agree not to, and not to allow others to:"],
      items: [
        { text: "use AnOps in breach of any law or regulation, or to infringe the rights of others;" },
        { text: "send marketing messages without a valid legal basis, such as consent, or ignore unsubscribe requests;" },
        { text: "upload malware or content that is unlawful, deceptive, defamatory or that you do not have the right to use;" },
        { text: "attempt to access another Company's data, bypass permissions, probe or test the security of the Platform without our written permission, or interfere with its operation;" },
        { text: "copy, resell or reverse engineer the Platform except where the law expressly allows it;" },
        { text: "use automated means to overload the Platform or to circumvent usage limits." },
      ],
    },
    {
      id: "customer-data",
      title: "Customer Data",
      body: [
        "As between you and AnOps, your Company owns its Customer Data. You grant AnOps a limited right to host, process and transmit Customer Data only as needed to provide, secure and support the Platform, and as described in the Privacy Policy.",
        "You are responsible for the accuracy and lawfulness of Customer Data and for having the rights and notices needed to process personal information about your employees, customers and contacts in AnOps.",
        "We keep Customer Data separated by Company and protected by the measures described in the Privacy Policy. Keep your own copies of important information; export features are available in several applications.",
      ],
    },
    {
      id: "ai-features",
      title: "AI Features",
      items: [
        { text: "AI Features are provided to assist you. Their outputs may be incomplete or inaccurate and are not professional, legal, financial or tax advice." },
        { text: "Actions prepared by AI are proposals. They take effect only when an authorised person confirms them, and you remain responsible for the actions you confirm." },
        { text: "AI access is always limited to what your role already allows and to what your Company has granted." },
        { text: "We may limit, suspend or change AI Features at any time, for example to respond to security risks or provider outages. The rest of the Platform remains usable when AI is unavailable." },
      ],
    },
    {
      id: "third-party-services",
      title: "Third-party services",
      body: [
        "Some features work with services operated by third parties, such as email and SMS providers, Telegram and Meta. Your use of those services is subject to their terms. We are not responsible for third-party services, and their availability or behaviour may change without notice.",
      ],
    },
    {
      id: "availability",
      title: "Availability and changes",
      body: [
        "We work to keep AnOps available and reliable, but we do not guarantee uninterrupted or error-free operation. We may perform maintenance and improve, change or discontinue features. Applications marked “Coming soon” or “In progress” are not yet generally available and their scope may change.",
      ],
    },
    {
      id: "intellectual-property",
      title: "Intellectual property",
      body: [
        "AnOps and its licensors own the Platform, including its software, design, brand and documentation. Except for the rights expressly granted in these Terms, no rights are transferred to you.",
        "If you send us feedback or suggestions, we may use them without obligation to you.",
      ],
    },
    {
      id: "suspension-and-termination",
      title: "Suspension and termination",
      body: [
        "You may stop using AnOps at any time. We may suspend or terminate access if you breach these Terms, if required by law, or to protect the Platform or other users. Where reasonable, we will give notice and an opportunity to resolve the issue first.",
        "After termination, Customer Data is handled as described in the Privacy Policy. Sections that by their nature should survive termination will survive.",
      ],
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      body: [
        "To the extent permitted by law, AnOps is provided “as is” and “as available”, without warranties of any kind, whether express or implied, including warranties of merchantability, fitness for a particular purpose and non-infringement. You remain responsible for your business decisions, including those informed by information or suggestions shown in AnOps.",
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      body: [
        "To the extent permitted by law, AnOps will not be liable for indirect, incidental, special or consequential damages, or for loss of profits, revenue, data or goodwill. Our total liability arising out of these Terms will not exceed the amounts you paid to AnOps for the Platform in the twelve months before the event giving rise to the claim, or, if you use only the Free plan, a nominal amount.",
        "Nothing in these Terms limits liability that cannot be limited by law, such as liability for fraud or wilful misconduct.",
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: [
        "We may update these Terms. We will change the “Last updated” date and, for material changes, notify you through the Platform or by email before they take effect. Continuing to use AnOps after that date means you accept the updated Terms.",
      ],
    },
    {
      id: "governing-law",
      title: "Governing law and disputes",
      body: [
        "These Terms are governed by the laws of the country in which the AnOps operator is established, without regard to conflict-of-laws rules, and without depriving you of protections that mandatory law in your country provides. We encourage you to contact us first so that we can try to resolve any disagreement informally.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      body: ["Questions about these Terms can be sent through the contact page. Please mention “Terms” in your message."],
    },
  ],
};
