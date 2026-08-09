> ARCHIVED 2026-08-05 — superseded by `docs/HANDOFF.md` and `docs/Project-Scale-Up-Plan.md`.
> Sections 1 (HTML email images) and 2 (hiring email template types) are already marked
> superseded inline below. Section 3 (Integrations tab) shipped — see `IntegrationsTab` in
> `app/(dashboard)/settings/page.tsx` and `GET /api/settings/integrations`. Section 4 (New
> Company Onboarding Flow) — `POST /api/settings/companies` shipped per `docs/HANDOFF.md`'s
> "Company lifecycle" line (migration 051); the multi-step wizard UI described here was never
> built, and the onboarding surface is now designed by `Project-Scale-Up-Plan.md`'s Open
> Decision 1 / Phase-plan / C10 carve-out (`app/(onboarding)/`) instead. The "SaaS prep notes"
> section is superseded wholesale by `Project-Scale-Up-Plan.md`'s 24-row constraint table and
> 10-phase plan. Kept for historical reasoning only — do not build against this file.

# Next Session Plan — Settings + Hiring + SaaS Foundations

## What was fixed this session (Settings)
- Company type labels now display as: IT, Security, CTF, Game Dev, AI, SaaS
- Type dropdown has proper options including AI + SaaS
- Bank details replaced from JSON textarea → 5 individual fields (Bank Name, Account Name, Account Number, IFSC, Branch)
- Company Seal → proper upload component (no more file path string)

---

## 1. HTML Email Templates with Local Images

> **SUPERSEDED (2026-07-11)** — Email Studio shipped both the base64-inlining fix (`api/lib/email-designs.ts` → `inlineImagesAsBase64()`, used by every design send) **and** option B below (Import HTML mode in `app/(dashboard)/email-studio/editor.tsx`, minus the zip requirement — plain HTML + individual image files, with automatic reference rewriting). See `docs/modules/EMAIL_STUDIO.md`. Section kept for historical context.

### The Problem
Hiring email templates use `{{variable}}` chips which render fine.
But if you want a fully branded HTML template (with header image, footer, logo baked in), the images are local files that can't be referenced in outgoing emails.

### Solution (pick one, recommend A):

**A. Use the Template Editor (already built) — RECOMMENDED**
- Insert images from the image library (you already have Ouantum assets uploaded)
- Template editor saves image URLs as `/api/uploads/...` which are served by CBOP
- At render time (`buildTemplateEmail`), image src attributes are already absolute-path-ready
- For outgoing emails: images need to be either:
  - **Embedded as base64** inline in `<img src="data:image/png;base64,...">` — works in all clients, no external dependency
  - **Hosted publicly** at a URL reachable by the recipient's email client (requires CBOP to be internet-accessible or use Cloudflare Tunnel)
- **Next step**: Update `buildTemplateEmail()` in `api/routes/templates.ts` to convert `/api/uploads/...` image srcs to base64 inline data URIs. Already have the file-reading infrastructure from PDF render.

**B. Upload HTML zip**
- User uploads a `.zip` containing `index.html` + `images/` folder
- CBOP extracts, rewrites image srcs to hosted paths, stores rendered HTML
- More complex, harder to edit after upload
- Not recommended unless you need to import existing HTML email designs from an external tool

### Recommended prompt for next session:
> "Update buildTemplateEmail() in api/routes/templates.ts to inline all /api/uploads/* image srcs as base64 data URIs so email clients can render images without needing CBOP to be publicly accessible."

---

## 2. Hiring Email Template Types — Do You Need More?

> **PARTIALLY SUPERSEDED (2026-07-11)** — Email Studio makes these easy to *author* (`hiring.ts`'s `renderEmailTemplate()` now checks `email_designs` by slug before the legacy `templates` table and the `DEFAULT_*` fallback), but the 3 trigger points below still don't exist anywhere in `hiring.ts`. Authoring is solved; wiring the triggers is still open — see `docs/modules/EMAIL_STUDIO.md` "Known gaps".

Current 4: Interview Confirmation, Rejection, Offer Letter, Welcome/Joining

**Missing templates that most hiring flows need:**
| Slug | When sent |
|---|---|
| `shortlist_notification` | When applicant is moved to shortlisted |
| `interview_reschedule` | When interview date changes |
| `interview_cancellation` | When interview is cancelled |
| `offer_acceptance_confirmation` | After intern replies "I ACCEPT" |
| `offer_declination_acknowledgement` | After intern replies "I DECLINE" |
| `internship_extension` | If internship period is extended |
| `internship_completion` | Certificate/completion email at end |
| `probation_pass` | If probation → full employee |

**Recommendation**: Add the top 3 first (shortlist, reschedule, cancellation). The others are for a more complete HR module.

### Prompt for next session:
> "Seed 3 new hiring email templates: shortlist_notification, interview_reschedule, interview_cancellation. Follow the same pattern as scripts/seed-hiring-email-templates.js. Then wire them up in hiring.ts: shortlist fires when applicant moves to 'shortlisted' stage, reschedule fires when PATCH /applicants/:id/schedule-interview is called on an applicant that already has an interview scheduled, cancellation fires from the existing cancel-interview endpoint."

---

## 3. Integrations Tab — Currently Shows Only One

The Integrations tab in Settings only shows one entry. What should be listed:

| Integration | Status | Notes |
|---|---|---|
| n8n (automations) | Connected | URL from N8N_URL env |
| OpenClaw / Nila | Connected | Telegram + WhatsApp + Discord bridge |
| Outline (SOPs) | Connected | OUTLINE_URL env |
| Nextcloud (files) | Connected | File storage |
| AWS S3 (backups) | Connected | Backup storage |
| Uptime Kuma | Connected | Monitoring |
| Gitea | Connected | Self-hosted git |
| SMTP (email) | Connected | From mailer.ts config |
| Ollama (AI scoring) | Connected | Local LLM for resume scoring |

### Prompt for next session:
> "Rebuild the Integrations tab in Settings to show all active integrations as status cards: n8n, OpenClaw/Nila, Outline, Nextcloud, AWS S3, Uptime Kuma, Gitea, SMTP, Ollama. Each card shows: name, icon (use Lucide), green/red status dot (ping the URL or check env var exists), and a 'Configure' link. No forms needed — all config is via .env."

---

## 4. New Company Onboarding Flow (SaaS Foundation)

### Current pain point
Adding a new company requires:
1. Manually INSERT into companies table
2. Manually assign company to users via user_companies table  
3. Upload logo + seal separately
4. Set bank details, GSTIN, UPI
5. No guided flow, no validation

### What to build (SaaS-ready onboarding wizard):

**Step 1 — Company Identity**
- Company name, legal name, type (IT/Security/CTF/Game Dev/AI/SaaS)
- Invoice prefix (3 chars, auto-suggest from name)
- Company address

**Step 2 — Tax & Payment**
- GSTIN, PAN
- UPI ID
- Bank details (already have the form fields)

**Step 3 — Brand Assets**
- Logo upload (PNG/SVG)
- Seal upload (PNG transparent)
- Logo initials (auto-fill from name)

**Step 4 — Assign Users**
- Multi-select existing users to assign to this company
- Optionally invite a new user (sends invite email)

**Step 5 — Review + Create**
- Summary card
- Creates company + user_companies rows + sets logo/seal

### DB changes needed:
- None — all tables already exist
- `companies` has all needed columns
- `user_companies` handles assignments

### API needed:
- `POST /api/settings/companies` — create new company (currently only PATCH exists)

### Prompt for next session:
> "Build a 'New Company' button in Settings → Companies tab that opens a multi-step slide-over wizard (5 steps: Identity → Tax & Payment → Brand Assets → Assign Users → Review). On finish, POST /api/settings/companies (create the endpoint), create user_companies rows for selected users, then upload logo/seal if provided. The slide-over should use the existing SlideOver component. Keep each step on one screen, with Back/Next navigation and a step indicator at the top."

---

## Priority order for next session

1. **Base64-inline images in email templates** — unblocks sending branded emails today
2. **New Company wizard** — needed before SaaS launch; currently manual DB work
3. **More hiring email templates** — shortlist + reschedule + cancel at minimum
4. **Integrations tab rebuild** — nice to have, low complexity

---

## SaaS prep notes (longer term)

When CBOP becomes multi-tenant SaaS:
- Auth needs: email verification, password reset (already exists), org-based login
- Billing: per-company subscription (Stripe or Razorpay)
- Data isolation: already enforced via `company_id = ANY($1)` on every query
- Branding: per-company subdomain or white-label option
- The current 3-user hardcoded model just needs user invite flow + role assignment UI
- The biggest missing piece is the **company creation wizard** above — everything else is already multi-tenant

Keep `requireRole('ceo')` on all company management routes — in SaaS, CEO = org admin.
