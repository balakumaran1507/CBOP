# Batch Interview System — Design Spec

**Last updated:** 2026-06-14  
**Status:** Planning — not yet built

---

## The model (in plain English)

One Google Meet link. One batch. N candidates. They don't all join at once — they join one at a time when it's their turn. CBOP controls the pace.

```
Batch created (10 candidates, 1 meet link, start time 2:00 PM)
        │
        ▼
All 10 get a "preparation email" at once:
"You're #3. Interviews start at 2:00 PM. Expect your turn ~2:30 PM.
We'll email you the Meet link the moment it's your turn."
        │
        ▼
Panel opens CBOP → Interview Mode → Candidate #1 loaded
Panel interviews #1 → takes notes in CBOP → clicks Done + Decision
        │
        ▼
CBOP emails Candidate #2 the Meet link: "It's your turn — join now."
Panel loads Candidate #2's card in CBOP automatically
        │
        ▼
Repeat until batch is complete
        │
        ▼
Batch summary shown: 4 accepted, 3 rejected, 3 on hold
Rejection emails queued. Offer letters queued for accepted.
```

---

## Are you overcomplicating it?

**No — but there is one real risk.**

The risk is **email latency + missed notifications**. When you click "Done" and CBOP emails candidate #3, that candidate:
- May not see the email for 2–5 minutes (Gmail delay, phone on silent)
- Is now sitting waiting, your panel is waiting, the batch is stalled

**Three ways to handle this:**

| Option | How | Reliability |
|---|---|---|
| **A. Email only** | Send "it's your turn" email | ⚠️ Risky — email can delay |
| **B. WhatsApp + email** | Send both simultaneously via cbop-bridge | ✅ Best — WhatsApp is instant |
| **C. Fixed slots** | Send all links upfront with times (2:00, 2:15, 2:30...) | ✅ Reliable but inflexible if interviews run long/short |

**Recommendation: Option B.** CBOP already has cbop-bridge → WhatsApp. When it's their turn, send a WhatsApp message AND an email simultaneously. WhatsApp is instant. Email is the backup. Collect candidate WhatsApp numbers at application time.

If they didn't provide a WhatsApp number, fall back to email only + add a 3-minute buffer note in CBOP ("email sent, wait ~3 mins before starting").

---

## Flow in detail

### Step 1 — Create a batch

Panel member goes to `/hiring` → **"New Interview Batch"** button.

Fields:
- **Company** (determines which email + which panelists are available)
- **Candidates** — multi-select from shortlisted applicants (drag to set order)
- **Batch start time** — date + time picker
- **Estimated duration per candidate** — default 15 min (sets expected slot times)
- **Meet link** — paste from Google Meet (manual for now; auto-generate later via Calendar API)
- **Panel members** — pick from CBOP users (Bala, Nabeelah, Guru, Rahul — filtered by company)
- **Buffer between candidates** — default 2 min (gives panel time to make notes before next person)

Preview before confirming:
```
#1  Priya Sharma      — 2:00 PM  (link will be sent at start)
#2  Arjun Kumar       — 2:17 PM  (link sent when #1 done)
#3  Meena Rajan       — 2:34 PM  (link sent when #2 done)
...
```

### Step 2 — Preparation email (sent to all candidates at once on confirm)

Subject: `Your Interview — [Company] | [Date]`

```
Hi {{name}},

You've been selected for an interview with {{company_name}}.

Your position in today's batch: #{{order}} of {{total}}
Interview date: {{date}}
Expected time: ~{{estimated_time}} (interviews are ~{{duration}} minutes each)

You do NOT need the meeting link yet. We will send it to you the moment 
it's your turn — watch your WhatsApp / email closely.

What to expect:
- You'll get a message (WhatsApp + email) when it's your turn
- Join the meeting within 2 minutes of receiving it
- The interview will be {{duration}} minutes

Please be ready from {{start_time}} onwards.

— {{company_name}} Team
```

### Step 3 — Interview Mode (CBOP panel view)

When the batch starts, a panel member opens **Interview Mode** — a full-screen view:

```
┌─────────────────────────────────────────────────────────────────┐
│  🎯 INTERVIEW MODE  |  Batch: June 14 — CYBERCOM  |  #1 of 10  │
├───────────────────────────────┬─────────────────────────────────┤
│                               │                                 │
│  CANDIDATE CARD               │  INTERVIEW PANEL                │
│  ─────────────                │  ────────────────               │
│  Priya Sharma                 │  AI Summary (3 lines)           │
│  Applied: Frontend Dev        │                                 │
│  AI Score: 82/100             │  Suggested Questions:           │
│                               │  1. Tell me about your React    │
│  [Resume — scrollable PDF]    │     experience...               │
│                               │  2. How do you handle...        │
│                               │  3. ...                         │
│                               │                                 │
│                               │  Live Notes:                    │
│                               │  ┌──────────────────────────┐  │
│                               │  │ type here during call... │  │
│                               │  └──────────────────────────┘  │
│                               │                                 │
│                               │  Decision:                      │
│                               │  [✅ Accept] [⏸ Hold] [❌ Reject]│
│                               │                                 │
│                               │  ──────────────────────────     │
│                               │  Next: Arjun Kumar (#2)        │
│                               │  [▶ Done — Send next invite]   │
│                               │                                 │
└───────────────────────────────┴─────────────────────────────────┘
```

**"Done — Send next invite" button:**
1. Saves notes + decision for current candidate
2. Moves their stage (accepted → selected, rejected → rejected, hold → shortlisted with tag)
3. Sends WhatsApp + email to next candidate with the Meet link
4. Loads next candidate's card automatically

### Step 4 — "Your turn" message (sent one at a time)

**WhatsApp** (via cbop-bridge):
```
Hi Priya! It's your turn for the interview. Please join now:
[Meet link]
```

**Email** (same time, backup):
Subject: `Join Now — Your Interview is Ready | [Company]`
```
Hi {{name}},

It's your turn! Please join the interview immediately.

Meeting link: {{meet_link}}

See you in a moment.
— {{company_name}} Team
```

### Step 5 — Batch complete

CBOP shows a summary:
```
Batch complete — June 14, CYBERCOM
────────────────────────────────────
Interviewed: 10 | Duration: 2h 47m
✅ Accepted: 4  →  [Generate & send offer letters]
⏸ On hold:  3  →  [Move to next batch] [Reject all]
❌ Rejected: 3  →  [Send rejection emails]
```

One-click bulk actions for each group.

---

## What CBOP needs to know per company (config)

| Field | Example |
|---|---|
| Interview email account | `founders@cybercomctf.com` |
| WhatsApp number for outbound | CYBERCOM WhatsApp Business number |
| Default panel members | [Bala, Nabeelah] for CYBERCOM |
| Default slot duration | 15 min |
| Google Meet link | Manually created reusable link per company (upgrade to auto-generate later) |

---

## What needs to be built (in order)

### Phase 1 — Foundation (build now)
- [ ] `hiring_batches` table — stores batch, candidates, order, meet link, status
- [ ] `hiring_batch_candidates` table — order, slot time, status, notes, decision
- [ ] `POST /api/hiring/batches` — create batch, send prep emails
- [ ] `PATCH /api/hiring/batches/:id/next` — mark current done, send next invite
- [ ] `GET /api/hiring/batches/:id` — batch status for interview mode UI
- [ ] Interview Mode page at `/hiring/batch/:id`
- [ ] Multi-page PDF resume viewer (react-pdf)
- [ ] AI interview questions endpoint (uses resume + role → Claude)

### Phase 2 — Polish (after Phase 1 works)
- [ ] WhatsApp notification via cbop-bridge (Phase 1 uses email only)
- [ ] Drag-to-reorder candidate list in batch creator
- [ ] Timer per candidate in interview mode
- [ ] Batch analytics (avg duration, pass rate by role, by company)

### Phase 3 — Automation (future)
- [ ] Google Calendar API → auto-generate Meet link per batch
- [ ] Calendar invites to panel members
- [ ] Reminder to panel 30 min before batch start

---

## What is NOT in scope for now

- Individual candidate waiting rooms (too complex, Google Workspace feature)
- Recording interviews (legal/privacy concerns)
- Scoring rubrics (can add later as structured notes)
- SMS fallback (WhatsApp covers it)
