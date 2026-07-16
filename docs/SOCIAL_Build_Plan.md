# Social Media Monitor & Dashboard - Build Plan

Tracking doc for the Social Media Monitor module. Update as phases complete -
this is the working notes file; `docs/HANDOFF.md` gets the end-of-session summary.

## Requested scope (verbatim intent from user)
- Social Media Monitor + Dashboard
- Real-time updates
- Trend analysis
- "use agents, plan first using R&D and then build a page prototype for me to review"
- Explicitly a PROTOTYPE for review this round, not a full production build - narrower ask than the SEO module's "build all of A/B/C now"

## Process
1. **Phase 1 - R&D** (parallel research forks, read-only): social monitoring SaaS landscape, official platform APIs + realistic access/cost, real-time/webhook feasibility + what "trend analysis" can actually mean here, legal/ToS boundaries (same posture as the Google-scraping boundary from the SEO module)
2. **Phase 2 - Feature list**: synthesized from Phase 1, prioritized
3. **Phase 3 - Prototype build**: one page, presented for review before any further build-out. Tightly scoped given the recent scope-overrun incidents this session - built either directly or via exactly one fork with hard, explicit boundaries.

## Phase 1 - R&D
Status: COMPLETE (4 parallel research forks, all read-only)

Key findings:
- **Owned-account management is the buildable core.** Scheduling, engagement analytics, unified inbox for comments/DMs on accounts CBOP's companies actually own - all via official platform APIs, same posture as the SEO module's Google integration.
- **True "social listening" (industry-wide trend/hashtag/competitor tracking) is NOT buildable in-house.** Real tools (Brandwatch, Meltwater) pay $16K-150K+/year for enterprise "firehose" data licenses. No API key gets you this. Do not attempt to fake it with scraping.
- **Legal boundary, still a hard no on scraping** - despite recent case law (X Corp v. Bright Data, Meta v. Bright Data) actually favoring scrapers of *public, logged-out* data, the practical reality for a small business with no legal team is: not worth the risk. hiQ v. LinkedIn's famous "scraping isn't CFAA" win still ended in a **$500K judgment against hiQ** for a different violation (fake accounts accessing logged-in-only pages). CBOP's Social Media Monitor is scoped to **official Business/Marketing APIs on owned accounts only** - never scraping, never fake accounts, never logged-in-wall bypassing.
- **Per-platform reality check, this changes the build order**:
  - **YouTube** - easiest, self-serve, free, ~10min setup (same ease as Google Search Console)
  - **Meta (Instagram + Facebook, shared auth)** - free API, but real app review required for production (2-4 weeks, business verification, screencast of the OAuth flow, high first-attempt rejection rate). Has genuine webhooks for real-time comment/mention push - the one platform with true real-time here.
  - **X (Twitter)** - killed its free tier entirely as of Feb 2026. Pay-per-use only ($0.005-0.015 per read/post, no practical free path). Building this means real ongoing cost, not just a one-time setup - flag clearly, let the user opt in per-connection.
  - **TikTok** - free but needs developer review (days-weeks), unaudited apps are forced content-private until passing a compliance audit.
  - **LinkedIn** - effectively closed off. No self-serve API since 2015, Partner Program approval takes weeks-to-months with unclear rejection reasons, and LinkedIn explicitly denies applications for competitive-intelligence/monitoring use cases outright. Deprioritized - not worth building against given the explicit restriction.
- **"Real-time" honestly scoped**: Meta webhooks = genuine real-time for Instagram/Facebook comments+mentions. Everything else = poll on a 15-30min interval (comfortably under every platform's rate limits) with an honest "last updated" timestamp, not a fake "live" claim.
- **"Trend analysis" honestly scoped to what's derivable from owned-account historical data**: engagement-rate trend over time, follower growth trend, week-over-week/month-over-month comparison, best-time-to-post derived from the account's own history (not generic published averages), top-performing content ranking. This is the real, deliverable version of "trend analysis" - not industry/competitor trends.

## Phase 2 - Feature list (prototype scope)
Status: proceeding directly to a single prototype page per the user's explicit ask ("plan first...then build a page prototype for me to review") - narrower than the SEO module's "build A/B/C now."

Prototype will show, with realistic scaffolding (real schema/API shape, not fake data structures) but degrading gracefully with zero live connections (same pattern as the SEO module before Google OAuth was configured):
1. Platform connection cards (YouTube, Instagram/Facebook, X, TikTok, LinkedIn) - each with an honest inline note about its real access reality (cost for X, review lead-time for Meta/TikTok, explicit "not recommended" for LinkedIn given the ToS restriction)
2. Unified content feed - recent posts across connected platforms with engagement metrics
3. Trend charts - engagement rate over time, follower growth, best-time-to-post heatmap, week-over-week comparison
4. Real-time mentions/comments panel (Meta webhook-fed when connected; poll-based elsewhere)
5. Alert strip for anomalies (engagement drop, follower loss) - same visual language as other Pulse-style alerts this session

## Phase 3 - Prototype build
Status: COMPLETE. Built directly (not forked) given this session's 2 prior scope-overrun incidents on background agents - a single contained page didn't need multi-agent parallelism anyway.

Built:
- `migrations/047_social_connections.sql` (applied) - `social_connections` (one row per company per platform, ready to hold real OAuth tokens once wired up) and `social_engagement_snapshots` (daily history the trend charts read from - empty until a real connection actually polls/webhooks data in)
- `api/routes/social.ts` - `GET /api/social/platforms` (static per-platform access-reality notes, not secrets), `GET/DELETE /api/social/connections`, `GET /api/social/trends/:companyId`. No OAuth flows built in this pass - explicitly deferred, this is the prototype round.
- `app/(dashboard)/social/page.tsx` - platform connection cards (honest inline notes per platform - X flagged as paid/no-free-tier, LinkedIn flagged not-recommended given its explicit ToS restriction on monitoring use cases), stat cards, engagement/follower trend charts, a best-time-to-post heatmap, a live mentions/comments panel. A "Preview with sample data" checkbox toggles between the real (currently empty) backend response and clearly-labeled sample data - real numbers are never faked as if live.
- Sidebar nav entry ("Social")

Deviation from a literal "just mock up the UI" prototype: built real backing schema + API (not fake data hardcoded into the component) so the page is honest about its own state and the next build round (real OAuth per platform) plugs directly into what already exists, matching the SEO module's staged approach.

**Bug caught during build**: `lucide-react` in this project's installed version has no brand/logo icons (Youtube/Instagram/Facebook/Linkedin/Twitter/TikTok all removed upstream, a known trademark-driven change) - `tsc` caught this immediately, swapped to generic icons (Video/Camera/Users/Briefcase/Music2) before it ever reached a build attempt.

Verification: `tsc --noEmit` clean, `npm run build` clean (`/social` route 5.39kB, in line with every other page this session), no em-dashes.

## Not built this round (explicitly deferred, same posture as SEO module's Phase D)
- Real OAuth flows per platform (YouTube is the realistic next one to wire up first - self-serve, free, no review wait, same ease as Google Search Console was)
- The actual polling/webhook jobs that populate `social_engagement_snapshots` with real data
- Any paid X (Twitter) integration - real ongoing cost, should be an explicit opt-in decision by the user, not a default
- LinkedIn integration - deprioritized given the explicit ToS restriction on monitoring/competitive-intelligence use cases found in Phase 1 R&D **for the monitoring/listening use case this module covers.** See below - a separate ask (publishing) got a separate R&D pass and a different answer.

---

## Social Media Manager (publishing) - LinkedIn R&D + build plan

Separate ask from the Monitor above: not "watch what's happening," but "draft and publish content CBOP's companies own." Different LinkedIn product, different access story, so it gets its own R&D and its own recommendation - the Monitor's `recommended: false` for LinkedIn does not carry over here.

### R&D findings

LinkedIn has two independent posting paths with very different feasibility:

**Path A - personal profile posting** (`w_member_social`, "Share on LinkedIn" product)
- Self-serve. Add the product in the Developer Portal, OAuth the member, done - no partner review, no wait.
- Posts as whichever person authenticates (e.g. Bala's own profile), not a company brand.
- Free. Rate limit 150 posts/day/member - not a real constraint.
- Access token expires in ~60 days; this self-serve tier does not get a refresh token (that's a separate gated grant), so the connection needs manual re-auth roughly every 2 months. Worth a Pulse reminder, not a blocker.

**Path B - company page posting** (`w_organization_social`, Community Management API)
- Gated. Development Tier -> Standard Tier, and Standard Tier requires a screen-recording demo of the actual use case.
- Practically requires provisioning through an Advertising API application tied to the same company page - i.e. each company (Etherence IT, AttackOS, etc.) likely needs a LinkedIn Ads account already set up for its page, even at $0 spend.
- Timeline: weeks to months (same order of magnitude as the Meta app review already flagged for Instagram/Facebook).
- No public per-call price for organic posting - the cost is approval friction/time, not a metered bill like X.
- Posts as the real company brand - what "social media manager" means for a business page.

**Why LinkedIn specifically**: it's the one channel that matches CBOP's actual audience - B2B IT consulting, pentest, cybersecurity CTF content, hiring posts. Two natural content sources already exist in the codebase: the Blog CMS (`blog_posts`) and the Hiring module (job listings) - both produce exactly the content LinkedIn rewards, so this isn't a standalone content product, it's a publish target for content that already gets created.

**AI angle**: CBOP already has an LLM pipeline (`api/lib/local-llm.ts`, used for blog SEO scoring, resume scoring, email drafts). Reuse it to draft a post from a blog post or job listing; human reviews/edits in a slide-over (same "AI drafts, human approves" shape as Email Studio and Blog CMS, no auto-publish); one click sends it via whichever path is connected.

### Build plan

**Phase 1 - Path A end-to-end (buildable now, zero external wait)**
- `api/lib/linkedin.ts` - OAuth helpers (authorize URL, code exchange, OpenID `userinfo` fetch for person URN + name) and `createLinkedInPost()` wrapping the Posts API.
- Migration `048_social_posts.sql`:
  - Extend `social_connections`: add `connection_type TEXT CHECK (connection_type IN ('member','organization'))` (existing `account_id`/`access_token`/`refresh_token`/`token_expires_at` columns are reused as-is).
  - New `social_posts` table: `id, company_id, connection_id, content, media_url, status ('draft'|'scheduled'|'published'|'failed'), scheduled_at, published_at, external_post_urn, ai_generated BOOL, source_type ('blog_post'|'job_listing'|'manual'), source_id, created_by, error_message, created_at`.
- `api/routes/social.ts` additions:
  - `GET /api/social/linkedin/auth` -> redirect to LinkedIn authorize (scope `openid profile w_member_social`)
  - `GET /api/social/linkedin/callback` -> exchange code, upsert `social_connections` row (`connection_type='member'`)
  - `POST /api/social/posts` - create draft (optionally `{ source_type, source_id }` to pull seed content, or freeform)
  - `POST /api/social/posts/generate` - LLM draft only, returns text into the compose form, never auto-saves/publishes
  - `PATCH /api/social/posts/:id`, `DELETE /api/social/posts/:id`
  - `POST /api/social/posts/:id/publish` - calls `createLinkedInPost()`, sets `published_at` + `external_post_urn`, or `status='failed'` + `error_message` on error
  - `GET /api/social/posts?companyId=` - list feed for the UI
- Frontend: compose slide-over on `/social` (AI-assist button, connection picker, preview, Save Draft / Publish Now), post list with status chips, "Connect LinkedIn (personal)" button on the existing LinkedIn platform card.
- `.env.example`: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`.
- Update `PLATFORM_INFO.linkedin` in `api/routes/social.ts` - `recommended: true` for this Path A flow, with a note distinguishing it from the not-yet-available company-page path.

**Phase 2 - Path B wiring (code buildable now, functionally gated on real approval)**
- Same `social_posts`/`createLinkedInPost()` machinery, `connection_type='organization'`, scope `w_organization_social`, author URN is the org URN (captured via a manual "paste your organization URN" field in the connect flow - looking it up programmatically needs yet another scope, not worth it for one field).
- Degrades the same way the Google OAuth-gated `/seo` features do: clear "not connected / pending LinkedIn approval" state, no crash, no fake data.
- **User-side action, not something to build**: actually filing the Community Management API application (Development tier now, Standard tier + screen recording later) and, per the FAQ, likely standing up a LinkedIn Ads account for at least one company page to provision it through. Flag this to the user as a real external step with a multi-week-to-month timeline, same as the Meta app review already called out for Instagram/Facebook.

**Phase 3 - deferred, not in this build**
- Auto-publish for `status='scheduled'` posts - per CLAUDE.md's no-custom-scheduler rule, this needs a real n8n workflow (poll `scheduled_at <= NOW()`, call the existing publish endpoint), same pattern already deferred for blog posts. Until then, scheduled posts sit for manual publish, worded as a reminder not a malfunction (same Pulse-alert posture as blog).
- Pulse reminder for LinkedIn connections nearing the ~60-day token expiry (Path A has no refresh token on the self-serve tier).
- Pulling Blog/Hiring content automatically into `social_posts` drafts (vs. the user manually picking a source post/listing) - nice-to-have, not required for a working publish loop.
