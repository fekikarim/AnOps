# AnOps AI Logo Generator — Roadmap, Setup and Verification

Where: **Organization → Settings → Brand identity** (`/organization/[orgId]/settings/brand`), owner only.
Rules followed: no commits/pushes, existing organization workflows untouched, Gemini is called only from the server, no key is ever shown, logged or stored.

## Status

| Phase | Scope | Status |
|---|---|---|
| 0 | Inspect org settings, tenant model, storage, AI integrations | Completed |
| 1 | Verify Gemini image API (model, endpoint, request/response) incl. a real smoke test | Completed (response parsing not verifiable with the available key, see §5) |
| 2 | Gemini image provider: key parsing, rotation, retries, error classification | Completed |
| 3 | Logo service: generate/edit, owner + plan + kill-switch checks, limits, lock, confirm/store | Completed |
| 4 | Secure serving route + identity display across the app | Completed |
| 5 | Logo Studio UI (generate, regenerate, modify, edit, download, discard, confirm) | Completed |
| 6 | Tests with mocked Gemini + live browser verification | Completed |
| 7 | Docs, env example | Completed |

## How it works
1. The owner describes the logo (and optionally style, colors, industry) → server action `generateLogoAction` → `generateLogoCandidate`.
2. The server checks: signed-in member of **that** organization (the id is verified against membership, never trusted), role `owner`, plan with AI features (trial, MaxOps, Custom + AI add-on; never OneOps/AllOps), platform kill switch, input validation, rate limits, and a per-organization lock (one generation at a time).
3. `GeminiImageProvider` calls Gemini and returns a candidate (JPEG) **to the browser only**. Nothing is stored; the organization's logo is untouched.
4. In the browser the owner can regenerate other concepts (up to 8 are kept for comparison), ask Gemini for a change (edit mode sends the selected image + instruction), and adjust it locally: zoom, move, margin, background (white / transparent / ink / citron / custom), plain-background removal with tolerance, and an optional **organization name in real type** (Manrope) under the symbol, so Gemini never has to spell the name. Download PNG and Discard are available.
5. **Use as Organization Logo** opens a confirmation dialog showing the current logo and the selected image. On confirm the composed PNG is sent to `setOrganizationLogoAction` → `setOrganizationLogo`.
6. The server re-validates the image from its bytes (PNG/JPEG/WebP signature, ≤ 3 MB, 128–4096 px, aspect ≤ 3:1; SVG, HTML, PDF and executables are refused), stores it in GridFS (`organization_logos`, metadata `companyId`, sha256, size), updates `companies.logoFileId/logoUrl/logoUpdatedAt` of the caller's own organization, and only then deletes the previous file. If any step fails the new file is removed, the old logo stays, and the dialog keeps the image so the owner can retry.
7. The logo is served by `GET /api/v1/organizations/[orgId]/logo?v=<fileId>` to members of that organization only (others get the same 404 as "no logo"), with `nosniff`, a `default-src 'none'; sandbox` CSP and private immutable caching. Because the URL is versioned, a new logo shows at once.
Where it appears: organization page header, organization switcher, "Your organizations" cards, the app launcher (/anops) Dock organization button. If the image cannot load, initials are shown instead.

## Provider setup
```
GEMINI_API_KEYS=key1,key2,key3          # comma separated, one key per entry
GEMINI_IMAGE_MODEL=gemini-nano-banana-2.1   # optional
GEMINI_API_BASE_URL=                    # optional: https:// proxy or http://localhost test double
```
- API used (checked against Google's current docs, https://aistudio.google.com/docs/image-generation): `POST https://generativelanguage.googleapis.com/v1beta/interactions` with headers `x-goog-api-key`, `Api-Revision: 2026-05-20`; body `{ model, input:[{type:"text"},{type:"image",mime_type,data}], response_format:{type:"image", mime_type:"image/jpeg", aspect_ratio:"1:1", image_size:"1K"} }`; the image is a base64 `image` block in `steps[].content[]`.
- **Verified by a real call:** only `image/jpeg` is accepted as output type (a PNG request is rejected with a clear error); the endpoint, header, model ids and request shape are accepted by Google. Output carries a SynthID watermark (Google).
- Models (Google's list at the time of writing): `gemini-nano-banana-2.1` (default, recommended for new projects), `gemini-3.1-flash-lite-image` (fastest/cheapest, weaker at multi-turn edits), `gemini-3.1-flash-image`, `gemini-3-pro-image` (best text rendering), `gemini-2.5-flash-image` (legacy). Imagen is shut down.
- Keys must be valid and separated by commas. Each entry is validated (20–100 safe characters, not two keys glued together); invalid entries are ignored and counted (administrators see a "no valid key" message if none remains).
- **Image generation needs billing on the Google project**: on the free tier all of these models have quota 0.

## Error handling
| Situation | Behaviour |
|---|---|
| No valid key | `PROVIDER_NOT_CONFIGURED`: "not set up on this server… configure GEMINI_API_KEYS" (mentions the missing-comma case) |
| Key rejected (401/403, "API key not valid") | Key skipped for 30 min, next key tried; all rejected → "key was rejected, administrator must update GEMINI_API_KEYS" |
| 429 / quota | **No key switching** (quotas are usually per project): key cools down for `Retry-After`, owner sees the wait time; later requests during the cooldown are answered locally without calling Google |
| "limit: 0 / Free Tier" | Classified as a plan problem: "enable billing for the Gemini API"; remembered during the cooldown so it is not mislabelled "busy" |
| 5xx, network failure, timeout (45–60 s) | Max 2 retries, exponential backoff + jitter, then "temporarily unavailable / took too long, your description is kept" |
| 400/422 invalid request, safety refusal | Never retried; owner is told to rephrase / adjust |
| 404 model | "model not available, set GEMINI_IMAGE_MODEL" |
| Unusable response (no image, not PNG/JPEG/WebP, > 12 MB) | "did not return a usable image" |
| Duplicate/concurrent request | One generation per organization at a time (lock with 3-minute expiry released in `finally`); the button is disabled while running |
Upstream explanations are logged on the server for operators and never sent to the browser. Cost controls: 6 generations / 10 min per person, 12 / hour and 40 / day per organization, 20 logo saves / hour; every generation is audited (`organization.logo_generated`, sizes and model only, never the description) and every change too (`organization.logo_updated`).

## Limitations
- Gemini output is a JPEG on an opaque background; "transparent" is produced in the browser by removing the plain background (works best on flat artwork with a uniform background).
- The generated art is a symbol; names are rendered by the studio, not by Gemini.
- "Apply change" edits the selected generated image, not the locally adjusted one; local adjustments reset when a new concept is created.
- Cancel stops waiting and ignores the answer, but Gemini may still finish (and bill) the request; the lock stays until it ends or expires.
- The studio needs a plan with AI features; there is no manual upload and no "remove logo" action (out of scope).

## Verification results
- Automated (Gemini mocked): provider (15) — success parsing in three response shapes, edit input, key rotation on rejected keys, all keys invalid, no rotation on 429, billing diagnosis, bounded retries with backoff, recovery, timeout/network, no retry on 400/safety, model 404, bad responses, no/malformed keys, no key in any error; image headers and key parsing (6); service (17) — success, brief never contains the name, edit, owner only (admin/manager/employee refused before any Gemini call), plan and kill switch, validation, per-person limit, single-flight lock + release after failure, every provider failure → actionable message without leaking keys, studio status, confirm stores/serves/replaces and deletes the old file, bad types/sizes refused with the logo unchanged, simulated database failure keeps the previous logo and removes the new file, retry works, save limit, cross-organization isolation; route (2) — member sees the image with safe headers, other organization's owner and anonymous users are refused.
- Live in the browser (production build; Gemini replaced by a local fake with a real JPEG): settings card → studio, generation with loading state, duplicate click disabled, prompt kept, concept comparison, "Apply change" (edit), confirmation dialog (focus inside, Escape cancels, logo untouched), confirm → success message "Your organization logo has been successfully updated!", logo visible and loaded in the organization header, switcher, organization list and the /anops Dock; provider 429 (single call, message, Try again), 503 (exactly 3 attempts, clear message, description kept), slow request hint after 12 s and Cancel, the per-person limit message, mobile 390 px (no overflow, confirmation as bottom sheet), non-owner admin sees "Only the organization owner can change the logo" and no form but can load the logo.
- **Real Gemini smoke test** (`scripts/gemini-image-smoke.ts`, keys read from `.env`, one call per model, nothing printed except status): the request is accepted by Google, but every image model answers **quota 0 on the Free Tier**, so no real image could be generated. Image **response parsing therefore rests on Google's documentation and mocked fixtures**; the first real generation after billing is enabled should be checked with the same script (`npx vite-node -c vitest.config.mts scripts/gemini-image-smoke.ts -- out.png`).

## Blockers and actions for you
1. Enable billing on the Google project behind the Gemini key(s) (Google AI Studio → API keys → set up billing). Until then the studio shows: "The connected Google project has no image-generation quota…".
2. **`.env` has a malformed `GEMINI_API_KEYS`**: the second entry is two keys joined without a comma, so only 2 of the 3 keys are valid; the studio ignores the joined entry. Add the missing comma. (Also: your `.env` contains live secrets — Gmail password, Brevo, Telegram, Facebook and Stripe keys; keep the file out of version control and rotate anything that was ever shared.)
3. After billing is on, run the smoke script once and generate a real logo in the studio.

## Files
New: `server/ai/image/{gemini-image.provider,gemini-keys}.ts`, `server/platform/{organization-logo.service,image-meta}.ts`, `app/api/v1/organizations/[orgId]/logo/route.ts`, `app/(workspace)/organization/[orgId]/settings/brand/page.tsx`, `features/platform/components/logo-studio.tsx`, `features/platform/logo/compose.ts`, `shared/components/ui/org-avatar.tsx`, `scripts/gemini-image-smoke.ts`, tests (`gemini-image-provider`, `image-meta`, `organization-logo`, `organization-logo-route`, `helpers/images`).
Changed (small): `server/ai/key-pool.ts` (invalid-key cooldown, custom cooldown, helpers; backward compatible), `server/db/indexes.ts` (TTL index for locks), `server/platform/access.ts` and `organization.service.ts` (logo url in organization data), `features/platform/actions/organization.action.ts` (two actions), organization layout/switcher/list/home (logo display), settings page (card), `.env.example`.
