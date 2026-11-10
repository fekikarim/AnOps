# AnOps Pricing Research & Proposal

**Date of research:** 2026-11-09 · **Author:** implementation agent · **Status:** proposal implemented in `src/shared/domain/plans.ts` (single source of truth). Changing a price means changing that file and this document together; existing Stripe subscriptions keep the price they were created with.

## 1. Market data (collected 2026-11-09)

| Vendor | Model | Price observed | Free tier | AI | Source |
|---|---|---|---|---|---|
| Odoo | Per user / month, all apps | Standard ≈ US$24.90 (first 12 months, annual) renewing ≈ US$31.10; Custom higher (multi-company, Studio, API). Prices vary by IP region; official page did not label billing basis unambiguously. | **One App Free**: one app, unlimited users, forever. Installing a 2nd app moves to Standard; adding a company moves to Custom. | "Agentic AI" listed on Custom; AI document scanning billed separately as IAP credits. | odoo.com/pricing; erpresearch.com/pricing/odoo; activepieces.com Odoo pricing 2026; octurasolutions.com (Apr 2026) |
| Zoho One | Per employee or per user / month | All-Employee US$37 (annual, first year) / ≈US$45 monthly; Flexible User US$90 annual / ≈US$105 monthly. Excl. VAT. | 30-day trial, no card (third-party sources). | "AI-powered analytics and BI" in Standard. | zoho.com/one/pricing.html; cloudwards.net; zenatta.com |
| ERPNext (Frappe Cloud) | Hosting per site / server, not per user | Sites from US$5/mo (₹410); dedicated servers from US$40/mo. Software itself is open source. | Self-hosting free. | — | frappe.io/cloud/pricing |
| Tunisian market | Mostly quotes; no public ERP SaaS list prices found | Indicative only: generic SaaS ≈ 30 TND/user/month; a US SaaS at ≈112 TND/user/month for 40 users (Tunisian integrator blog, 2026). | — | — | kolonell.com (2026 blog posts) |

Notes and caveats:
- Third-party sources disagree on Odoo's exact US figure (outliers US$16.90 and US$44.90 exist; regional pricing). We use only the range above.
- Zoho Flexible User has one outlier source (US$67); the majority figure is used.
- No comparable public price list was found for Tunisian ERP SaaS, so we make **no** "cheaper than local competitors" claim.

## 2. Positioning assumptions

1. AnOps prices **per organization with unlimited users** (competitors price per user). This is the main differentiator and must stay simple.
2. AnOps today has 9 available applications; CRM and Sales are placeholders. Pricing stays well below per-user suites for any team above ~2 users, which is justified by the narrower current scope.
3. AI features have real variable cost (Groq/OpenRouter/Gemini tokens). They are isolated in **MaxOps** and an explicit **AI add-on** for Custom, with the existing per-person and per-company token budgets.
4. Billing currencies: **USD** and **EUR** through Stripe Checkout. Organizations whose currency is TND are billed in EUR by default (owner can switch to USD). We do not display TND prices because we have not verified Stripe TND settlement for this account; this is documented as an open item.
5. Annual billing = 10 × monthly (two months free), a common SaaS convention.

## 3. Proposal

| Plan | Applications | Users | AI features | Monthly | Annual |
|---|---|---|---|---|---|
| **OneOps** | 1 (chosen once, permanent) | Unlimited | No | Free | Free |
| **Custom** | 2–9 chosen applications (AnOps AI only with the add-on) | Unlimited | Optional AI add-on | US$9 / €8 per application, **capped at US$45 / €42** | 10 × monthly |
| **AllOps** | 10 (all except AnOps AI) | Unlimited | None anywhere | US$49 / €45 | US$490 / €450 |
| **MaxOps** | All 11 | Unlimited | Yes, complete AI ecosystem | US$99 / €89 | US$990 / €890 |
| AI add-on (Custom only) | — | — | Yes | US$29 / €27 | 10 × monthly |

Why these numbers:
- **Entry**: free OneOps mirrors the strongest competitor free tier (Odoo One App Free) and keeps unlimited users.
- **AllOps advantage**: Custom is capped at US$45, always below AllOps (US$49). From 5 applications upward the cap applies, and the UI recommends AllOps (10 applications for US$4 more).
- **Illustrative comparison** (list prices above, 10 users, monthly equivalents): Odoo Standard ≈ US$249–311; Zoho One All-Employee ≈ US$370 (annual rate); AnOps AllOps US$49 flat. This compares price only, not feature depth; Odoo and Zoho cover far more functionality today.
- **MaxOps** doubles AllOps to cover AI token costs and stays below the price of three Odoo Standard users.

## 4. Trial and free rules (implemented)

- 1 application selected at `/trial` → OneOps free, permanent, no AI.
- 2–3 applications → 15-day trial of those applications, AI features included (a preview of MaxOps limited to the selected apps), no card.
- AnOps AI cannot be the only free application (it is an AI application and OneOps excludes AI).
- After trial: choose AllOps, MaxOps, Custom, or fall back once to OneOps keeping one of the trial applications (one-time, immutable).

## 5. Open items

- Owner sign-off on the proposed prices before live mode.
- Verify Stripe TND support/settlement if local-currency billing is wanted.
- VAT/tax handling (Stripe Tax not configured).
