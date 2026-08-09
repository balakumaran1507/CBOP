# Email Studio

A global email design + send system. One template table (`email_designs`), one full-screen editor, one activity log — every part of CBOP that sends email (Documents, Campaigns, Hiring, internal/n8n automations) composes and sends through it instead of rolling its own subject/body fields.

## Why this exists

Before this, email composition was scattered across three places, each worse than the last:

1. **Documents** ("send via email" in the generate flow) — a subject `<input>` + plain `<textarea>` in a cramped slide-over. No formatting, no images, no reuse.
2. **Campaigns** (new campaign composer) — a raw HTML `<textarea>` with a `dangerouslySetInnerHTML` preview. No template library, no image upload.
3. **Hiring** (`hiring.ts`) — looked up a row in the `templates` table (Document Studio) by slug, falling back to hardcoded `DEFAULT_*` string constants if no template existed.

Email Studio consolidates authoring into one system while leaving each module's own send mechanics (Documents' batch pipeline, Campaigns' recipient lists + throttling, Hiring's trigger points) untouched.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  /email-studio  (page.tsx)                                          │
│  ── Designs gallery   ── Full-screen editor   ── Activity log        │
└───────────────┬───────────────────────────────────────┬─────────────┘
                 │ reads/writes                          │ reads
                 ▼                                       ▼
        email_designs                          email_send_log
                 ▲               ▲                       ▲
                 │ picks a design│ attaches a PDF         │ every send logs here
   ┌─────────────┴──┐   ┌────────┴─────────┐   ┌──────────┴─────────┐
   │ Documents       │   │ document_generated│   │ api/lib/mailer.ts  │
   │ generate flow   │   │ (Document Studio  │   │ sendEmail()        │
   │                 │   │  PDFs)            │   │                    │
   └─────────────────┘   └───────────────────┘   └─────────────────────┘
                 ▲                                        ▲
   ┌─────────────┴──┐                        ┌────────────┴─────────┐
   │ Campaigns        │                       │ Hiring / n8n          │
   │ composer          │                      │ /api/internal/        │
   │ (load/save)       │                      │ send-email             │
   └───────────────────┘                      └────────────────────────┘
```

The pre-existing `templates` table (Tiptap-based Document Studio editor) is untouched and still owns PDF documents (invoices, proposals, contracts, offer letters). Email Studio can *import* an `output_type='email'` template row from it once (`POST /api/email-designs/import-from-template/:templateId`) as a starting point, but new emails are authored directly in `email_designs`.

## Data model

- **`email_designs`** (migration `014`, extended in `022`/`023`) — the design itself. `content_mode` is `'richtext'` (Tiptap JSON in `design_json`) or `'html'` (raw HTML in `html`). `category` is free text (`campaign | hiring | transactional | document | internal | onboarding`). `is_global` designs aren't tied to one company. `slug` is an optional stable key for code (hiring.ts, n8n) to reference without a UUID.
- **`email_design_assets`** (migration `022`) — best-effort record of images uploaded into a design via the HTML-import flow.
- **`email_send_log`** (migration `014`, extended in `022`) — every outbound email CBOP sends, now with `design_id` + `attachment_refs` when the send came from a design.

## Backend

- **`api/lib/tiptap-render.ts`** — the generic Tiptap-JSON → HTML renderer, extracted out of `api/routes/templates.ts` so both Document Studio and Email Studio share one implementation. `renderTiptapNode()` takes an `onUnhandled` callback so Document Studio can layer its company-letterhead node types (`imagePlaceholder`, `pageBreak`) on top without forking the function.
- **`api/lib/email-designs.ts`** — `renderDesignHtml(design, vars)`, `extractVariables(design)`, `inlineImagesAsBase64(html)` (rewrites `/api/uploads/...` image `src`s to `data:` URIs so email clients render them with no dependency on CBOP being internet-reachable), and `sendDesignEmail(...)` — the one function every integration calls to actually send a design.
- **`api/routes/email-studio.ts`** — CRUD for designs, `POST /:id/upload-html` (asset rewriting for the HTML-import mode — actually mounted at `POST /api/email-studio/upload-html`, not tied to a design id so it works before a new design has been saved), `GET /:id/render` (compiled HTML with merge tags left literal, for callers like Campaigns that want to load a design as an editable starting point), `POST /:id/test-send`, `POST /:id/send` (direct small-batch, capped at 25 recipients — bulk goes through Campaigns), `GET /attachable-pdfs`, `GET /api/email-send-log`.

## Frontend

- **`app/(dashboard)/email-studio/page.tsx`** — Designs gallery (filterable by category, searchable) + Activity tab.
- **`app/(dashboard)/email-studio/editor.tsx`** — full-screen editor (same shell pattern as `app/(dashboard)/templates/editor.tsx`), with a Rich Text / Import HTML mode toggle:
  - **Rich mode** — a Tiptap instance reusing `FontPicker` (`app/(dashboard)/templates/font-picker.tsx`) and a local `VariableChip` node for `{{var}}` insertion.
  - **Import HTML mode** — paste or upload a `.html` file, upload the images it references, "Rewire image refs" matches uploaded filenames to `<img src>` references and rewrites them to hosted `/api/uploads/...` URLs (unmatched refs are flagged), with a live preview `<iframe>`.
- **`app/(dashboard)/email-studio/design-picker.tsx`** — `<EmailDesignPicker>`, the reusable "pick or author a design" control embedded in Documents and Campaigns. Portals its dropdown to `document.body` (same fix as `font-picker.tsx`) so it isn't clipped by a scrollable ancestor.

## Integration points

- **Documents** (`app/(dashboard)/documents/generate-slide-over.tsx` → `api/routes/documents.ts`): the "send via email" step uses `<EmailDesignPicker>` instead of raw subject/message fields. `POST /api/documents/templates/:id/generate` takes `email_design_id`; `runBatch()`/`sendDocumentEmailViaDesign()` renders the design with each recipient's own CSV row as merge vars and attaches that recipient's own generated PDF automatically.
- **Campaigns** (`app/(dashboard)/campaigns/new-campaign-slide-over.tsx`): "Load from Email Studio" populates the existing subject/body fields from a design's rendered HTML (still editable afterward); "Save as Design" persists the current subject/body back as a reusable `category='campaign'` design. Campaigns' own bulk-send pipeline (`email_recipients`, rate limiting, suppression) is unchanged.
- **Hiring** (`api/routes/hiring.ts` → `renderEmailTemplate(slug, vars)`): lookup order is now **Email Studio design (by `slug`) → legacy Document Studio template (by `slug`) → hardcoded `DEFAULT_*` constant**. Existing templates and fallbacks keep working unchanged; new hiring emails should be authored in Email Studio going forward.
- **Internal / n8n** (`POST /api/internal/send-email`, `api/routes/internal.ts`): accepts an optional `design_id` + `vars` as an alternative to raw `html`/`text`. This is the hook for n8n workflows to trigger a Studio-authored transactional email by id instead of inlining HTML into the workflow.

## Adding a new transactional email type

1. Create the design in Email Studio (`/email-studio` → New Design), set a `slug` (e.g. `shortlist_notification`).
2. From code: `POST /api/internal/send-email` with `{ to, design_id, vars }`, or from `hiring.ts`, call `renderEmailTemplate(slug, vars)` and send via the existing `sendEmail()`/`sendDesignEmail()` helpers.
3. From n8n: same `POST /api/internal/send-email` call, protected by `N8N_WEBHOOK_SECRET` (`x-internal-secret` header) — never exposed externally via Nginx, per the standing CBOP constraint.

## Known gaps / natural next steps

- The 3 hiring email types flagged in `docs/archive/NEXT_SESSION_PLAN.md` (`shortlist_notification`, `interview_reschedule`, `interview_cancellation`) aren't wired to any trigger point in `hiring.ts` yet — Email Studio makes them easy to *author*, but the endpoints that would fire them still need to be built.
- Campaigns' bulk send doesn't record which `email_designs` row a campaign started from (no `marketing_campaigns.source_design_id` column) — "Save as Design" and "Load from Email Studio" are one-way copies, not a persistent link.
- `email_design_assets` is best-effort bookkeeping (populated on HTML-import rewrites), not yet surfaced in any "manage assets" UI.
