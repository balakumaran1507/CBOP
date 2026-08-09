# CBOP Hiring Module — Overhaul Plan
**Created:** 2026-06-16  
**Status:** Active — agents executing

---

## Problems (in priority order)

### P1 — AI Scoring is broken / quality-blind
- OpenClaw's `/complete` endpoint powers all resume intelligence. When it's down, every call returns `__openclaw_complete_unavailable__` and scores stay at 0.
- Even when it works, `scoreResume()` is **purely rule-based**: counts prizes, counts projects, counts skills. A "minor" CTF cert and a DEFCON finalist score the same. A 3-month internship and a 12-month one may score similarly. Quality is invisible.
- The Anthropic SDK / paid API is no longer the path. **Decision: self-host Gemma via Ollama**.

### P2 — DOCX resumes can't be viewed in-page
- PDFs render fine via `PdfViewer`. DOCX files show a download-only button.
- Comparing applicants required downloading each DOCX, opening in Word, then going back. This wastes 3–5 minutes per comparison session.
- **Decision: mammoth.js** — converts DOCX to HTML on the backend, renders in an iframe in-page. Zero extra infrastructure needed.

### P3 — Hiring page UX is too slow for comparison
- The split-panel shows one applicant at a time. Switching between candidates loses context.
- Score breakdown (skills_score, prizes_score, etc.) is noisy. What matters is: "is this person good or not?"
- **Decision: add a Compare Mode** — select 2–4 applicants, show them side-by-side with key signals. Keep single-panel as default.

---

## Solution Architecture

### 1. Local LLM Scoring — Ollama + Gemma

**Infrastructure:**  
Ollama does NOT run on the CBOP homeserver — it runs on a **separate LAN machine** (the one with more RAM or a GPU). The CBOP server talks to it over the local network via `OLLAMA_URL`.

**On the Ollama machine (separate PC/server):**
```bash
# Install Ollama (Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Bind to all interfaces so the CBOP server can reach it
OLLAMA_HOST=0.0.0.0 ollama serve &

# Pull the model (pick based on available RAM)
ollama pull gemma3:4b    # ~3GB RAM — preferred
# ollama pull gemma2:2b  # ~1.5GB RAM — fallback if RAM is tight
```

**On the CBOP server (.env):**
```
OLLAMA_URL=http://<ollama-machine-lan-ip>:11434
OLLAMA_MODEL=gemma3:4b
```

No docker-compose change needed — Ollama is not in the CBOP compose file.

**New scoring flow:**
1. Resume text + role title → single Ollama prompt
2. Gemma returns a structured JSON:
   ```json
   {
     "score": 72,
     "grade": "B",
     "summary": "3-sentence narrative",
     "strengths": ["...", "..."],
     "gaps": ["...", "..."],
     "signals": {
       "depth": 7,
       "breadth": 6,
       "practical": 8,
       "communication": 6
     }
   }
   ```
3. Store `ai_score` (0–100), `ai_summary` (narrative), `ai_score_breakdown` (signals JSON) in DB

**New API:** `POST /api/hiring/applicants/:id/score` — unchanged endpoint signature, new Ollama backend

**New lib:** `api/lib/local-llm.ts`
```typescript
export async function ollamaComplete(prompt: string, system?: string): Promise<string>
export async function scoreResumeWithLLM(resumeText: string, roleTitle: string, requiredSkills: string[]): Promise<LLMScore>
```

**Scoring prompt design (captures quality not quantity):**
```
You are a technical hiring reviewer at a security/dev firm. Evaluate this resume for the {roleTitle} role.

Required skills: {skills}

Resume:
{text}

Score 0–100 holistically. Consider:
- DEPTH of knowledge (not just listing tools — showed they built things)
- PROJECT QUALITY (solo toy project vs shipped product vs open source contribution)
- PRIZE QUALITY (local college hackathon vs national/international CTF or comp)
- RELEVANCE to the role
- COMMUNICATION clarity in the resume itself

Do NOT reward:
- Long lists of skills without evidence of use
- Prizes without context (type, scope, ranking)
- Generic descriptions ("built a web app")

Return ONLY valid JSON matching this schema (no preamble, no markdown):
{"score":0-100,"grade":"A|B|C|D|F","summary":"3 sentences max","strengths":["..."],"gaps":["..."],"signals":{"depth":0-10,"breadth":0-10,"practical":0-10,"communication":0-10}}
```

**Fallback:** If Ollama is unreachable, log warning and keep existing score unchanged (don't zero it out).

---

### 2. DOCX In-Page Viewer — mammoth.js

**Backend endpoint:**  
`GET /api/hiring/applicants/:id/resume/html`
- Reads the resume file from disk (same as `/resume/file`)
- If `.docx`: runs `mammoth.convertToHtml({ path })` → returns `{ html: "..." }`
- If `.pdf`: return 400 (use existing `/resume/file` for PDFs)
- Auth: `requireAuth`

**Frontend:**  
In `ApplicantDetailPanel`, resume section:
```
PDF → PdfViewer (existing)
DOCX → <iframe srcdoc={html} /> rendered from /resume/html endpoint
DOC (old binary) → download button (mammoth doesn't support .doc)
Image → <img> (existing)
```

The iframe gets a fixed height (700px) with scroll. No external dependencies beyond `mammoth` npm package.

**npm install:**
```bash
npm install mammoth
npm install -D @types/mammoth
```

---

### 3. Hiring Page UX Redesign

**Goal:** Faster triage, cleaner comparison, less clicking.

**Changes:**

#### 3a. Score display overhaul
- Remove `ScoreBreakdown` component showing 5 separate scores
- Show: big grade badge (A/B/C/D/F) + score number + 3-line narrative summary
- The `signals` (depth/breadth/practical/communication) shown as 4 small bar-charts, not raw numbers

#### 3b. Compare Mode (new)
- Checkbox on each applicant row in the left panel
- "Compare (N)" floating button appears when 2–4 are checked
- Opens a full-screen overlay: N columns, each showing:
  - Name, grade, score
  - Strengths (bullets)
  - Gaps (bullets)
  - Signal bars (depth/breadth/practical/comms)
  - Inline resume viewer (PDF or DOCX HTML)
- "Open in detail" button per column
- Keyboard shortcut: Escape to close

#### 3c. Quick triage shortcuts
- `S` = shortlist current applicant
- `R` = reject current applicant (opens reason dialog)
- `J/K` = next/previous applicant in list
- Visible in bottom bar: "S shortlist · R reject · J/K navigate"

#### 3d. Applicant card in left panel
- Show: name, grade badge (A/B/C/D), score, role, college, time ago
- Remove: redundant stage label (already in filter)

---

## Implementation Order

| # | Task | Agent | Status |
|---|------|-------|--------|
| 1 | DOCX viewer (mammoth) | Agent A | 🔄 |
| 2 | Ollama docker-compose + local-llm.ts | Agent B | 🔄 |
| 3 | Rewrite resume-scorer.ts to use Ollama | Agent B | 🔄 |
| 4 | Score display redesign (grade badge + signals) | Manual | ⏳ |
| 5 | Compare Mode UI | Manual | ⏳ |
| 6 | Keyboard shortcuts for triage | Manual | ⏳ |
| 7 | n8n workflow credential cleanup | Manual | ⏳ |

---

## Files that will change

```
docker-compose.yml                  — add Ollama service + ollama_data volume
api/lib/local-llm.ts                — NEW: Ollama API wrapper + scoring
api/lib/resume-scorer.ts            — REWRITE: use local-llm instead of openClawComplete
api/routes/hiring.ts                — add /resume/html endpoint
app/(dashboard)/hiring/page.tsx     — DOCX iframe, score display, compare mode, shortcuts
app/components/pdf-viewer.tsx       — untouched (still handles PDF)
```

---

## YAML config — Ollama service

Full updated `docker-compose.yml` ollama block:
```yaml
  ollama:
    image: ollama/ollama:latest
    container_name: cbop_ollama
    ports:
      - "127.0.0.1:11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_HOST=0.0.0.0
    restart: unless-stopped

volumes:
  ollama_data:
```

**env var to add to .env:**
```
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

---

## Open questions / deferred

- **GPU acceleration**: The homeserver may have a GPU. If so, add `nvidia` Docker runtime for 10× faster Gemma inference. Check with `nvidia-smi`. Not blocking.
- **Re-scoring existing applicants**: After Ollama is live, we'll want a bulk re-score job for applicants with `ai_scored_at IS NULL` or flagged as `__openclaw_complete_unavailable__`. Simple: admin button → `POST /api/hiring/rescore-all` → loops and calls `/score` per applicant.
- **DOC (old binary .doc format)**: mammoth only handles `.docx`. Old `.doc` stays as download. Applicants using `.doc` are rare — we prompt them to submit PDF anyway.
- **Compare Mode mobile**: Not needed — Bala/Nabeelah/Guru use desktop.

---

## Additional fixes landed alongside this overhaul

These weren't in the original P1/P2/P3 scope but were fixed in the same working session.

### Batch interview — single role no longer forced
`hiring_batches.role_id` is now optional. Role association lives on `hiring_applicants.role_id` (per-applicant), not the batch. A batch can mix applicants from different roles in one interview session — the role filter in the "New Batch" slide-over is just a convenience filter when picking candidates, not a hard constraint.
- `api/routes/hiring-batches.ts` — `role_id` optional in POST body type; prep/turn emails now JOIN `hiring_roles` per-applicant and use `applicant.role_title` instead of one batch-wide role.
- `app/(dashboard)/hiring/page.tsx` — BatchSlideOver: role filter relabeled "Role (optional — filters candidates)", removed the gate that blocked candidate selection until a role was picked.
- `app/(dashboard)/hiring/batch/[id]/page.tsx` — `Batch.role_id`/`role_title` made nullable, null-guarded in question generation and display.

### Delete Record — silent failure fixed
Root cause: two bugs stacked. (1) `hiring_batch_candidates`, `intern_records`, and `hiring_comments` reference `hiring_applicants(id)` with no `ON DELETE CASCADE`, so deleting an applicant referenced by any of those threw an FK violation. (2) The frontend ignored the DELETE response status and always closed the panel as if it succeeded, hiding the error.
- `api/routes/hiring.ts` — DELETE handler now explicitly deletes `hiring_batch_candidates` → `intern_records` → `hiring_comments` → `hiring_applicants` in that order before the delete completes.
- `app/(dashboard)/hiring/page.tsx` — delete button now checks `res.ok` and `alert()`s the error instead of refreshing/closing on failure.

### Roles tab — simplified from 10 fields to 4
Audited which of the 10 fields on the role form were actually read anywhere in the codebase. Only `company_id`, `title`, `required_skills` (used by `scoreResumeWithLLM` for AI scoring), and `is_active` were referenced. Removed `role_type` (14-option dropdown), `is_technical`, `preferred_skills`, `min_year`, `slots`, `description` from the form — DB columns and API are untouched, just no longer exposed in the UI, so nothing breaks if they're reintroduced later.
- `app/(dashboard)/hiring/page.tsx` — RoleSlideOver narrowed 440px → 380px, 4 fields only.

### Settings — Hiring Integrations card simplified
Removed Discord Invite URL (Discord invite links expire, making the stored value go stale silently) and Google Calendar ID (no clear self-serve way for the user to obtain one, and Meet links are pasted manually anyway — see "Known issues" in HANDOFF.md) from the Hiring Settings Integrations card. Only Slack Workspace Invite URL remains. DB columns (`discord_invite_url`, `google_calendar_id`) and the `HiringSettings` type are untouched — same "hide in UI, don't break the data layer" pattern as the Roles tab.
- `app/(dashboard)/settings/page.tsx` — Hiring tab → Integrations card.

### Email template redesign — every transactional HTML email rebuilt
All hardcoded HTML email builders across the hiring module were redesigned to a single shared design system: white background, thin `#E5E7EB` 1px borders (no shadows/rounded "AI generated" card look), a 4px brand-accent top bar, system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica Neue, Arial, sans-serif`) for cross-client rendering, `IBM Plex Mono`-style monospace (`ui-monospace, 'Cascadia Code', 'Courier New', monospace`) for slot numbers/links/data, and a plain text+border footer instead of a colored block. Per-company brand color/tagline/signoff (`COMPANY_BRAND` map) is preserved as the only per-company variation — just applied through the new shared frame instead of a gradient header block.
- `api/routes/hiring-batches.ts` — added shared `emailWrap()` helper; rewrote `buildPrepEmail`, `buildTurnEmail` (dropped the 🎯 emoji heading), `buildCancelEmail` (was a bare `<p>` fragment with no `<!DOCTYPE>`/wrapping at all — now a full document matching the rest), and the offer-letter PDF HTML (Puppeteer-rendered — dropped Arial/blue-border-bottom look for the same accent-bar + clean table style).
- `api/routes/hiring.ts` — rewrote `buildRejectionHtml` and the offer-letter PDF HTML (`/applicants/:id/generate-offer`) to match.
- Left untouched, intentionally: the interview-confirmation email in `hiring.ts` (~line 944) — it's a plain-text `{{var}}` template from `hiring_settings` run through `interpolate()` then `.replace(/\n/g, '<br>')`, not an HTML builder, and rewriting it is a settings-template-editor change, not a code change.
- Out of scope (not hiring-module emails, left as-is): the campaign-unsubscribe confirmation page in `email-campaigns.ts` and the subscriber-unsubscribe page in `subscribers.ts` — these are static landing pages, not transactional emails sent to applicants.

### UI cleanup — emoji removal, Lucide icons, no glow/colored-outline cards
Done in two passes across the whole frontend (`app/` only — backend Telegram/console text in `api/` is plain-text and out of scope). `lucide-react` added to `package.json`.

**Pass 1** — `sidebar.tsx` nav icons (`LayoutDashboard`, `TrendingUp`, `CheckSquare`, `FileCode2`, `Users`, `Megaphone`, `UserCheck`, `FileText`, `Terminal`, `Settings`), plus emoji/arrow replacements and colored-card-outline neutralization (→ `#F8F9FA` bg / `#E5E7EB` border) across `hiring/page.tsx`, `work/page.tsx`, `settings/page.tsx`, `ceo/page.tsx`, `campaigns/new-campaign-slide-over.tsx`, `documents/generate-slide-over.tsx`, `documents/template-editor-slide-over.tsx`, `subscribers/page.tsx`, `sales/page.tsx`, `pdf-viewer.tsx`.

**Pass 2** (caught what pass 1 missed — `✕ ✓ ✗ ⚠ 🔗 📄 🛡 ✎ 👁 🔒`) — close buttons (`✕` → `X`), decision glyphs (`✓`/`✗` → `CheckCircle2`/`XCircle`), warnings (`⚠` → `AlertTriangle`), placeholders (`🔗` → `Link as LinkIcon`, `📄` → `FileText`, `🔒` → `Lock`), and inline action labels (`🛡 Check spam score` → `Shield` icon, `✎`/`👁` Edit/Preview toggle → `Pencil`/`Eye`) across `hiring/page.tsx`, `hiring/batch/[id]/page.tsx`, `templates/page.tsx`, `campaigns/new-campaign-slide-over.tsx`, `sales/page.tsx`, `settings/page.tsx`, `documents/page.tsx`, `documents/generate-slide-over.tsx`, `documents/template-editor-slide-over.tsx`, `ceo/page.tsx`, `mentor/shared/[token]/page.tsx`.

A final `grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' app/` returns zero matches. Plain arrows (`→`, `↓`) and the dash-style bullet glyphs in export buttons were left as typographic characters, not emoji — out of the directive's scope. Status badge pill colors and button colors were intentionally left untouched; only non-button, non-badge container backgrounds/borders were neutralized. `npx tsc --noEmit` and `npm run build` both pass clean; server restarted on the combined changes.

### Plain-text emails → branded HTML, and offer letters unified onto Document Studio templates

Two inconsistencies the user flagged: (1) the interview-confirmation, rejection-custom-template, and welcome emails were still being sent as a raw `.replace(/\n/g,'<br>')` text dump — no border, no brand accent, nothing like the redesigned templates above. (2) Two parallel offer-letter pipelines existed: a hardcoded inline-Puppeteer-HTML generator (used by the batch-interview "hired" workflow) and the real Document Studio template system (background image + tagged fields, used only by a manual per-applicant "Send Offer" flow). Uploading/tagging an offer letter template on the Documents page had no effect on what happened when a batch interview completed — that's the root cause of the disconnect the user noticed.

**Branded HTML for `{{var}}`-template emails**
- `api/routes/hiring.ts` — added `textToEmailHtml()` (splits on blank lines into `<p>` blocks) and reused the existing `emailWrap()` (now exported from `hiring-batches.ts`) to wrap interview-confirmation, custom-rejection, offer, and welcome email bodies in the same bordered/accent-bar frame as every other transactional email. Previously only the *default* hardcoded templates (`buildRejectionHtml`, etc.) were branded — the user-editable `hiring_settings` templates were not.

**Offer letters unified onto Document Studio**
- `api/routes/documents.ts` — `runBatch()` now returns `Promise<string[]>` (the `document_generated.id` of each PDF it creates) instead of `void`, so callers can know what was generated without re-querying.
- `api/routes/hiring-batches.ts` — `PATCH /batches/:id/complete` no longer launches Puppeteer with an inline HTML string. It now looks up the company's most-recently-updated `document_templates` row with `doc_type='offer_letter'`, maps each accepted candidate's `{name, email, role, college, ...}` onto the template's tags (case-insensitive), creates one `document_batches` row, and calls `runBatch()` (`sendEmail=false` — sending is still a separate explicit step). Each applicant's `offer_letter_url` is set to `doc:<document_generated.id>`, and the response includes `offer_url: /api/documents/generated/<id>/pdf` per offer. If no `offer_letter` template exists for the company, the route returns `template_missing: true` instead of crashing.
- `api/routes/hiring.ts` — fixed a pre-existing bug in `generate-offer-from-template`: it was storing `offer_letter_url = doc:<document_batches.id>`, but `/send-offer`'s attachment lookup queries `document_generated` by that id — different tables, so the PDF attach would have silently failed. Now awaits `runBatch()` and stores `doc:<document_generated.id>` (the first generated id) instead.
- `app/(dashboard)/hiring/batch/[id]/page.tsx` — "View Offer" now links directly to `offer.offer_url` (the real PDF endpoint) instead of the old single-applicant Puppeteer route. Added a `template_missing` notice telling the user to upload/tag an offer letter template for that company on the Documents page.
- Removed the now-fully-dead `POST /api/hiring/applicants/:id/generate-offer` endpoint from `hiring.ts` (the old hardcoded-Puppeteer single-applicant generator) — safe only after the frontend link above stopped pointing to it.

**Tested**: wrote a disposable script (`scripts/test-offer-flow.ts`, deleted after the run) that replicated the exact `/complete` handler logic against the real DB — created a throwaway applicant/batch/candidate row for CYBERCOM CTF (which has a real `Internship_Offer_Letter` template tagged `name/date/position/duration`), ran the real `runBatch()` against it, confirmed a real PDF was generated on disk (254KB) with the tags correctly filled, then deleted all test rows and the test PDF. `npx tsc --noEmit` and `npm run build` both pass clean; server restarted and confirmed serving the new build (BUILD_ID timestamp matches).
