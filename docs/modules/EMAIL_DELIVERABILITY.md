# CBOP Email Deliverability Runbook

> Goal: every CBOP email lands in **Primary inbox**, never Spam/Promotions.
> This is 90% DNS (server-side) + 10% sending hygiene (code). Do the DNS first.

Last audited: 2026-06-13 (live `dig` against all sending domains).

---

## 0. The rule (Gmail/Yahoo bulk-sender policy, 2024+)

Every sending domain MUST have **all three** aligned:

| Mechanism | What it proves | Where it lives |
|---|---|---|
| **SPF**   | "this IP is allowed to send for my domain" | TXT at the root domain |
| **DKIM**  | "this message was cryptographically signed by my domain" | TXT at `google._domainkey.<domain>` (Google signs it) |
| **DMARC** | "if SPF/DKIM fail, here's what to do + send me reports" | TXT at `_dmarc.<domain>` |

Missing **any** one → spam/promotions. Missing DMARC specifically is why your
Google-Workspace mail (SPF+DKIM already pass) still lands in Promotions.

---

## 1. Current state (live audit)

Re-audited 2026-07-11 via `dig` — all three previously-flagged domains now pass all three checks. `email_domains.spf_ok/dkim_ok/dmarc_ok` updated to match.

| Domain | Platform | SPF | DKIM | DMARC | Action |
|---|---|---|---|---|---|
| cybercomctf.com | Google Workspace | ✅ | ✅ | ✅ | None — fully compliant |
| ouantum.com     | Google Workspace | ✅ | ✅ | ✅ | None — fully compliant |
| zapsters.in     | Google Workspace | ✅ | ✅ | ✅ | None — fully compliant |
| etherence.com   | Namecheap forwarding only | ⚠️ (forwarding SPF, not Google) | ❌ | ❌ | Blocked in code until Workspace is bought |
| attackos.com    | Namecheap forwarding only | ⚠️ (forwarding SPF, not Google) | ❌ | ❌ | Blocked in code until Workspace is bought |

---

## 2. DNS records to add NOW (copy-paste)

Add these at each domain's DNS host (Namecheap → Advanced DNS, or wherever the
zone lives). TTL = Automatic / 3600 is fine.

### cybercomctf.com
```
Type: TXT   Host: _dmarc   Value:
v=DMARC1; p=none; rua=mailto:dmarc@cybercomctf.com; ruf=mailto:dmarc@cybercomctf.com; fo=1; adkim=r; aspf=r; pct=100
```

### ouantum.com
```
Type: TXT   Host: _dmarc   Value:
v=DMARC1; p=none; rua=mailto:dmarc@ouantum.com; fo=1; adkim=r; aspf=r; pct=100
```

### zapsters.in   ← needs SPF too (currently has none)
```
Type: TXT   Host: @        Value:
v=spf1 include:_spf.google.com ~all

Type: TXT   Host: _dmarc   Value:
v=DMARC1; p=none; rua=mailto:dmarc@zapsters.in; fo=1; adkim=r; aspf=r; pct=100
```

> `p=none` = **monitor only** (won't bounce anything). It turns on reporting so you
> can confirm 100% of mail passes. Leave it 1–2 weeks, read the `rua` reports, then
> tighten — see §4.

---

## 3. etherence.com & attackos.com — activation checklist (when Workspace is bought)

Until these steps are done, **CBOP will refuse to send as these domains** (the
verified-domain guard in `api/lib/mailer.ts`). Sending from them now would fail
SPF + have no DKIM and damage the reputation of every CBOP domain.

1. Buy Google Workspace for the domain; verify ownership.
2. **MX** — replace the Namecheap `eforward*.registrar-servers.com` records with:
   ```
   1   ASPMX.L.GOOGLE.COM
   5   ALT1.ASPMX.L.GOOGLE.COM
   5   ALT2.ASPMX.L.GOOGLE.COM
   10  ALT3.ASPMX.L.GOOGLE.COM
   10  ALT4.ASPMX.L.GOOGLE.COM
   ```
3. **SPF** — `TXT @  →  v=spf1 include:_spf.google.com ~all`
4. **DKIM** — Google Admin → Apps → Google Workspace → Gmail → *Authenticate email*
   → Generate 2048-bit key → publish the given `google._domainkey` TXT → click Start.
5. **DMARC** — `TXT _dmarc  →  v=DMARC1; p=none; rua=mailto:dmarc@<domain>; fo=1; adkim=r; aspf=r; pct=100`
6. Create the `founders@<domain>` mailbox, generate a Gmail **App Password**, and put
   it in `.env` (replace the `PLACEHOLDER_SET_REAL_APP_PASSWORD` lines).
7. Mark the domain verified in CBOP (Settings → Email Domains, or the seed insert in
   migration 014). The guard will then allow sends.

---

## 4. Tightening DMARC (after ~2 weeks of clean `p=none` reports)

Ramp the policy. Do NOT jump straight to reject.
```
p=none        →  p=quarantine; pct=25  →  p=quarantine; pct=100  →  p=reject
```
Stay at each step a few days, watching the aggregate reports. Stop ramping if any
legitimate source starts failing.

---

## 5. Sending hygiene (handled in CBOP code)

DNS gets you *authenticated*; these keep you *out of Promotions*:

- **One sending domain per company**, From == authenticated SMTP user == DKIM `d=`
  (alignment). The verified-domain guard enforces this.
- **Always send `text` + `html`** multipart. HTML-only looks like spam.
- **`List-Unsubscribe` + `List-Unsubscribe-Post: One-Click`** headers on bulk mail
  (already present; required by Gmail for senders >5k/day, good practice always).
- **Low image-to-text ratio**, no link shorteners, no `bit.ly`, real reply-to.
- **Honor unsubscribes/bounces instantly** via the suppression list.
- **Warm up volume** — don't send 2000 cold emails on day one from a fresh list.
- Gmail/Workspace hard caps: ~2000 recipients/day per account. CBOP rate-limits to
  1/sec and the pluggable transport lets you swap in Amazon SES if you outgrow this.

---

## 6. Amazon SES — bulk-campaign transport (added 2026-06-16)

**Why:** Google Workspace mailboxes are for 1:1 founder email, not bulk campaign
sends. A brand-new Workspace account has zero sending reputation, and Google's
abuse detection will lock the mailbox ("534-5.7.9 WebLoginRequired", or worse,
a Trust & Safety "Gmail unavailable" service restriction) on a high-volume burst
— this happened to `founders@zapsters.in` on 2026-06-15/16 sending ~900 campaign
emails in a day. SES is built for exactly this: it maintains its own IP/domain
reputation, has direct feedback loops with Gmail/Outlook, and supports a plain
SMTP interface — so nodemailer doesn't change at all, just the host/credentials.

**Code is already wired** (`api/lib/mailer.ts`): any domain row in `email_domains`
with `provider = 'ses'` automatically routes through the shared SES SMTP
transport instead of a per-mailbox Workspace login — `getCampaignTransporter`,
`sendEmail`, and the campaign send loop all pick it up with no further code
changes. Daily-cap accounting (`email_domains.daily_cap`) still applies per
domain regardless of provider.

### Setup (AWS console + DNS — one-time, per domain)

1. **AWS SES console** → *Verified identities* → *Create identity* → Domain →
   enter the domain (e.g. `zapsters.in`). Pick the region you'll use everywhere
   (e.g. `us-east-1` or `ap-south-1` — must match `SES_SMTP_HOST` below).
2. Enable **Easy DKIM** — SES gives you 3 CNAME records. Add them at the
   domain's DNS host. These run *alongside* the existing Google DKIM record
   (different selector), no conflict.
3. **SPF** — merge SES into the *existing* SPF TXT record (you can only have
   one SPF TXT per domain):
   ```
   v=spf1 include:_spf.google.com include:amazonses.com ~all
   ```
4. Wait for verification to flip to "Verified" in the SES console (DNS
   propagation, usually under an hour).
5. **Request production access** — SES starts every new account in the
   *sandbox* (can only send to verified addresses, ~200/day, 1/sec). SES
   console → *Account dashboard* → *Request production access*. Describe the
   use case (internship/recruiting campaign emails, opt-out + suppression
   list already implemented, sending volume you expect). Usually approved
   within a few hours to a day for a clear, legitimate case.
6. **Generate SMTP credentials** — SES console → *SMTP settings* → *Create SMTP
   credentials*. This creates a dedicated IAM user + generates an SMTP
   username/password pair — **not** the same as your `AWS_ACCESS_KEY_ID` used
   for S3 backups. Put them in `.env`:
   ```
   SES_SMTP_HOST=email-smtp.<region>.amazonaws.com
   SES_SMTP_PORT=587
   SES_SMTP_USER=<generated>
   SES_SMTP_PASS=<generated>
   ```
7. Flip the domain over in the DB:
   ```sql
   UPDATE email_domains SET provider = 'ses' WHERE domain = 'zapsters.in';
   ```
8. Still ramp volume gradually even on SES — `daily_cap` should start low
   (e.g. 50–100/day) and climb over 1–2 weeks as bounce/complaint rates stay
   clean. SES's own sending quota also grows automatically with good history,
   but CBOP's cap is the first line of defense either way.

### What stays the same

Campaign creation, editing, recipient list management, scheduling, pause/resume
— none of it changes. This is purely a transport swap underneath `getCampaignTransporter`.

---

## 7. Verify your fix

After DNS propagates (up to a few hours):
```bash
dig +short TXT _dmarc.cybercomctf.com
dig +short TXT zapsters.in | grep spf
```
Then send one test to a Gmail address and use **Show original** → confirm
`SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Or send to `check-auth@verifier.port25.com`
/ use mail-tester.com for a 10/10 score.
