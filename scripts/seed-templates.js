#!/usr/bin/env node
/**
 * Seed 10 professional templates for Etherence IT.
 * Run: node scripts/seed-templates.js
 */

const { Client } = require('pg')
require('dotenv').config({ path: '.env.local' })

const client = new Client({ connectionString: process.env.DATABASE_URL })

const TEMPLATES = [
  {
    name: 'Service Agreement — IT Consulting',
    type: 'contract',
    content: `SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into as of {{date}} between {{company_name}} ("Service Provider") and {{client_name}} of {{client_org}} ("Client").

1. SCOPE OF SERVICES
Service Provider agrees to deliver the following services: {{service_description}}

All deliverables, timelines, and acceptance criteria shall be documented in a mutually agreed Project Brief prior to commencement of work.

2. PAYMENT TERMS
Total contract value: {{amount}}
Payment schedule:
- 50% advance payment due upon signing this Agreement
- 50% balance due upon delivery and Client's written acceptance of all deliverables

Invoices are payable within 14 days of issue. Late payments attract interest at 1.5% per month on the outstanding amount.

3. TERM
This Agreement commences on {{start_date}} and concludes on {{end_date}}, unless terminated earlier in accordance with Clause 8.

4. INTELLECTUAL PROPERTY
All work product, code, designs, documentation, and deliverables produced by Service Provider under this Agreement shall become the sole property of Client upon receipt of full payment. Until full payment is received, all work product remains the property of Service Provider.

Service Provider retains the right to use general methodologies, frameworks, and know-how developed in the course of providing services.

5. CONFIDENTIALITY
Each party agrees to keep confidential all non-public information received from the other party, including but not limited to business data, technical specifications, financial information, and client lists. This obligation survives termination of this Agreement for a period of three (3) years.

6. WARRANTIES
Service Provider warrants that:
(a) The services will be performed in a professional and workmanlike manner;
(b) The deliverables will conform to the agreed specifications;
(c) Service Provider has the right to enter into this Agreement and perform the services.

7. LIMITATION OF LIABILITY
Service Provider's total liability under this Agreement shall not exceed the total contract value ({{amount}}). In no event shall either party be liable for indirect, consequential, or punitive damages.

8. TERMINATION
Either party may terminate this Agreement with thirty (30) days' written notice. In the event of termination by Client, all completed work shall be billed at the agreed hourly rate. Advance payments are non-refundable for work already commenced.

9. GOVERNING LAW AND DISPUTE RESOLUTION
This Agreement is governed by the laws of India. Any dispute shall first be subject to good-faith negotiation. If unresolved within 30 days, disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996. The seat of arbitration shall be Chennai, Tamil Nadu. Jurisdiction for all legal proceedings is exclusively with courts in Chennai.

10. ENTIRE AGREEMENT
This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations, representations, or agreements relating to the subject matter herein.

IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.

{{company_name}}
GSTIN: {{company_gstin}}

_________________________
Authorised Signatory

CLIENT: {{client_org}}
_________________________
{{client_name}}
`,
  },

  {
    name: 'Penetration Test Scope of Work',
    type: 'contract',
    content: `PENETRATION TESTING SCOPE OF WORK AND AUTHORISATION AGREEMENT

Engagement Reference: {{date}}
Prepared by: {{company_name}}
Client: {{client_org}} — {{client_name}}

1. AUTHORISATION DECLARATION
Client hereby declares and warrants that it is the legal owner of, or has explicit written authorisation to test, all systems, networks, and applications included within the defined scope below. Client accepts full legal responsibility for ensuring all in-scope assets are legitimately authorised for testing. {{company_name}} shall bear no liability for any unauthorised testing that results from Client providing incorrect or incomplete scope information.

2. SCOPE OF ENGAGEMENT
{{scope_description}}

Out-of-Scope: Any systems, IP addresses, domains, or applications not explicitly listed above. Testing of third-party infrastructure (cloud providers, CDN, DNS registrars) requires separate written authorisation from those providers.

3. METHODOLOGY
Testing approach: {{methodology}}

Phase 1 — Reconnaissance: Passive and active information gathering
Phase 2 — Vulnerability Identification: Automated and manual scanning
Phase 3 — Exploitation: Controlled exploitation of identified vulnerabilities
Phase 4 — Post-Exploitation: Privilege escalation, lateral movement assessment
Phase 5 — Reporting: Detailed findings documentation

4. RULES OF ENGAGEMENT
- Testing hours: Business days, unless agreed otherwise in writing
- No denial-of-service testing without explicit written approval
- No data exfiltration beyond proof-of-concept screenshots
- Any critical finding (active compromise, data exposure) to be reported immediately via phone/Telegram
- Client to designate a technical point of contact available throughout the engagement

5. FINDING CLASSIFICATION
Critical: Immediate exploitable vulnerability allowing full system compromise or significant data breach
High: Significant vulnerability requiring prompt remediation
Medium: Vulnerability with limited direct impact but exploitable under specific conditions
Low: Minor security concern with minimal risk
Informational: Security best practice recommendations

6. DELIVERABLES
{{deliverables}}

Standard deliverables include:
- Executive Summary (non-technical, suitable for management)
- Technical Report with full proof-of-concept details
- Remediation Guidance with prioritised fix recommendations
- Re-test of critical and high findings (one round included)

Timeline: {{timeline}}

7. COMMERCIAL TERMS
Total engagement fee: {{amount}}
Payment: 50% advance, 50% on delivery of final report

8. RESPONSIBLE DISCLOSURE
All findings are strictly confidential. {{company_name}} will not disclose any findings to third parties without Client's written consent. Client agrees not to publicly disclose the engagement or findings without {{company_name}}'s written review.

9. LIMITATION OF LIABILITY
{{company_name}}'s aggregate liability is limited to the engagement fee ({{amount}}). Service Provider is not liable for any business disruption arising from the testing activities where such disruption results from pre-existing vulnerabilities.

10. GOVERNING LAW
Chennai jurisdiction. Governed by the laws of India.

SIGNED on {{date}}

{{company_name}}                    {{client_org}}
_________________________           _________________________
Authorised Signatory                {{client_name}}
`,
  },

  {
    name: 'CTF Event Proposal',
    type: 'proposal',
    content: `CAPTURE THE FLAG EVENT PROPOSAL

Prepared for: {{client_org}}
Prepared by: {{company_name}}
Date: {{date}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{company_name}} proposes to design, host, and deliver a professional Capture The Flag (CTF) cybersecurity competition for {{client_org}}.

Event: {{event_name}}
Date: {{date}}
Venue: {{venue}}
Participants: {{participant_count}}
Investment: {{amount}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVENT OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A Capture The Flag competition is a cybersecurity challenge event where participants solve security puzzles across multiple domains to earn points. It is widely used by universities, corporations, and defence organisations for talent identification, team building, and training.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHALLENGE CATEGORIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Web Security — SQL injection, XSS, authentication bypasses, API vulnerabilities
Cryptography — Classical ciphers, modern encryption, hash challenges
Digital Forensics — File analysis, memory forensics, log analysis, steganography
Binary Exploitation — Buffer overflows, format strings, ROP chains
Miscellaneous — OSINT, trivia, custom challenges aligned to your theme

Difficulty distribution: 30% Beginner / 40% Intermediate / 30% Advanced

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLATFORM FEATURES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Custom domain with your organisation's branding
- Real-time dynamic scoreboard with team rankings
- Anti-cheat system (flag rotation, rate limiting, team isolation)
- Challenge infrastructure with automatic flag validation
- Hint system with configurable point deductions
- Admin dashboard for live monitoring and event control
- Geographic distribution support for remote participants
- Post-event analytics: solve rates, time-to-solve, category performance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEAM AND INFRASTRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Event Director: Experienced CTF organiser with 5+ national events
Challenge Authors: Minimum 3 domain experts per category
Technical Ops: Live monitoring, incident response, server uptime guarantee
On-site Support: Available for in-person events

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DELIVERABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{deliverables}}

Standard inclusions:
- Full event platform, operational 48 hours before event start
- All challenge content (minimum 25 challenges for 100 participants)
- Live support throughout the event
- Post-event report: participation stats, top performers, challenge difficulty analysis
- Challenge writeups for educational distribution (optional)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INVESTMENT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: {{amount}}

Payment terms: 50% advance to confirm the event date, 50% within 7 days of event completion.

Cancellation: Full refund if cancelled 30+ days before event. 50% refund if cancelled 15–29 days before. No refund within 14 days of event.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Confirm scope and participant count
2. Sign Service Agreement and remit advance payment
3. 4-week build phase begins
4. Platform goes live for participant registration

This proposal is valid for 30 days from {{date}}.

{{company_name}}
`,
  },

  {
    name: 'Game Development Contract',
    type: 'contract',
    content: `GAME DEVELOPMENT CONTRACT

This Agreement is entered into as of {{date}} between {{company_name}} ("Developer") and {{client_name}} of {{client_org}} ("Client") for the development of {{project_name}}.

1. PROJECT OVERVIEW
Developer agrees to create {{project_name}} as described in the agreed Game Design Document (GDD), which forms Schedule A to this Agreement.

2. MILESTONE-BASED DELIVERY

Milestone 1: {{milestone_1}}
Milestone 2: {{milestone_2}}
Milestone 3 (Final Delivery): {{milestone_3}}

Each milestone requires Client's written acceptance within 7 calendar days of delivery. Silence after 7 days constitutes acceptance.

3. PAYMENT SCHEDULE
Total contract value: {{total_amount}}
Advance payment (on signing): {{advance_amount}}
Remaining balance payable pro-rata across milestones.

Late payment: 1.5% per month interest on outstanding amounts.

4. INTELLECTUAL PROPERTY
All game assets, source code, scripts, artwork, music, and documentation produced under this Agreement shall transfer to Client upon receipt of full payment. Developer retains no licence or rights to the work product after transfer.

Developer retains the right to list {{project_name}} in its portfolio (name and screenshots only) unless Client requests otherwise in writing.

5. REVISIONS
Each milestone includes 3 revision rounds. Additional revisions requested beyond this are billed at ₹2,500 per hour. Revisions must be submitted as a consolidated list; piecemeal requests are batched.

6. TECHNOLOGY STACK
Agreed engine and technology stack shall be documented in the GDD. Changes to the core technology stack requested by Client after development begins are treated as change orders and priced separately.

7. ACCEPTANCE TESTING
Client has 7 days per milestone to test and report defects. Reported defects are addressed in the next development cycle. Cosmetic preferences not captured in the GDD are out of scope.

8. KILL FEE AND TERMINATION
If Client cancels this Agreement after development has commenced, Client shall pay for all completed work at ₹2,500 per hour (based on Developer's logged hours), plus materials cost. Advance payments are credited against this amount.

If Developer fails to deliver a milestone within 14 days of the agreed date without written notice of delay, Client may terminate and receive a pro-rata refund of payments made for undelivered milestones.

9. WARRANTIES
Developer warrants that the final deliverable will be free of known critical bugs, run on the agreed target platform, and conform to the agreed GDD.

10. GOVERNING LAW
This Agreement is governed by the laws of India. Disputes are subject to the exclusive jurisdiction of courts in Chennai, Tamil Nadu.

{{company_name}}                    {{client_org}}
_________________________           _________________________
Authorised Signatory                {{client_name}}
Date: {{date}}
`,
  },

  {
    name: 'Non-Disclosure Agreement — Mutual',
    type: 'nda',
    content: `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of {{date}} between:

Party A: {{party_a}}
Party B: {{party_b}}

collectively referred to as the "Parties."

PURPOSE
The Parties wish to explore a potential business relationship involving: {{purpose}}

In connection with this purpose, each Party may disclose confidential information to the other.

1. DEFINITION OF CONFIDENTIAL INFORMATION
"Confidential Information" means any non-public information disclosed by one Party to the other, whether orally, in writing, or in any other form, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure. This includes, without limitation, business plans, financial data, technical specifications, client lists, pricing, trade secrets, and proprietary methodologies.

2. EXCLUSIONS
Confidential Information does not include information that:
(a) Is or becomes publicly known through no breach of this Agreement;
(b) Was rightfully known by the receiving Party before disclosure;
(c) Is received from a third party without restriction;
(d) Is independently developed by the receiving Party without use of the Confidential Information;
(e) Is required to be disclosed by law, court order, or government authority, provided the disclosing Party is given prompt notice and reasonable opportunity to seek a protective order.

3. OBLIGATIONS
Each Party agrees to:
(a) Hold all Confidential Information of the other Party in strict confidence;
(b) Use Confidential Information solely for the Purpose stated above;
(c) Restrict access to Confidential Information to employees and advisors who have a need-to-know and are bound by confidentiality obligations no less restrictive than those herein;
(d) Not copy, reproduce, or reduce to writing any Confidential Information except as reasonably required for the Purpose.

4. DURATION
This Agreement is effective from {{date}} and the confidentiality obligations shall continue for {{duration_years}} years from the date of last disclosure of Confidential Information.

5. RETURN OR DESTRUCTION
Upon request by either Party or upon termination of discussions, each Party shall promptly return or destroy all Confidential Information received, including copies and summaries, and certify such return/destruction in writing if requested.

6. NO LICENCE GRANTED
Nothing in this Agreement grants either Party any rights in or to the other Party's Confidential Information except as expressly stated herein. No patent, copyright, trademark, or other intellectual property right is licensed or transferred by this Agreement.

7. INJUNCTIVE RELIEF
Each Party acknowledges that any breach of this Agreement would cause irreparable harm for which monetary damages would be an inadequate remedy. Accordingly, either Party shall be entitled to seek injunctive relief and specific performance without the requirement of posting a bond.

8. GOVERNING LAW
This Agreement is governed by the laws of India. Jurisdiction: {{jurisdiction}} courts.

9. ENTIRE AGREEMENT
This Agreement constitutes the entire understanding between the Parties regarding confidentiality and supersedes all prior discussions on the subject.

SIGNED as of {{date}}

{{party_a}}                         {{party_b}}
_________________________           _________________________
Authorised Signatory                Authorised Signatory
`,
  },

  {
    name: 'Non-Disclosure Agreement — One Way',
    type: 'nda',
    content: `ONE-WAY NON-DISCLOSURE AGREEMENT

This Non-Disclosure Agreement ("Agreement") is entered into as of {{date}} between:

Disclosing Party: {{disclosing_party}}
Receiving Party: {{receiving_party}}

PURPOSE
Disclosing Party intends to share certain confidential information with Receiving Party in connection with: {{purpose}}

1. DEFINITION OF CONFIDENTIAL INFORMATION
"Confidential Information" means any non-public information disclosed by Disclosing Party to Receiving Party in connection with the Purpose, whether in written, oral, visual, electronic, or any other form, and whether or not marked as "confidential."

This includes, without limitation: business strategies, financial projections, client data, technical documentation, source code, pricing structures, employee information, and any other proprietary business information.

2. EXCLUSIONS
The obligations of this Agreement do not apply to information that:
(a) Is or becomes part of the public domain through no act of Receiving Party;
(b) Was rightfully in Receiving Party's possession prior to disclosure;
(c) Is independently developed by Receiving Party without reference to the Confidential Information;
(d) Is received from a third party lawfully entitled to disclose it;
(e) Is required to be disclosed by applicable law or valid court order, subject to Receiving Party providing Disclosing Party with prompt prior written notice.

3. OBLIGATIONS OF RECEIVING PARTY
Receiving Party agrees to:
(a) Maintain strict confidentiality of all Confidential Information;
(b) Use the Confidential Information solely for evaluating or undertaking the Purpose;
(c) Not disclose Confidential Information to any third party without prior written consent of Disclosing Party;
(d) Limit access to Confidential Information to authorised personnel on a strict need-to-know basis;
(e) Protect the Confidential Information with at least the same degree of care it uses for its own confidential information, but no less than reasonable care.

4. TERM
Obligations under this Agreement shall remain in effect for {{duration_years}} years from the date of this Agreement.

5. RETURN OF INFORMATION
Upon Disclosing Party's written request, Receiving Party shall promptly return or certify destruction of all Confidential Information.

6. NO RIGHTS GRANTED
This Agreement does not grant Receiving Party any licence, right, or interest in any Confidential Information or any intellectual property of Disclosing Party.

7. REMEDY
Receiving Party acknowledges that unauthorised disclosure of Confidential Information may cause irreparable harm. Disclosing Party shall be entitled to seek injunctive relief in addition to any other remedies available at law.

8. GOVERNING LAW
This Agreement shall be governed by and construed in accordance with the laws of India. The courts of Chennai, Tamil Nadu, shall have exclusive jurisdiction.

SIGNED on {{date}}

{{disclosing_party}}
_________________________
Authorised Signatory

{{receiving_party}}
_________________________
Authorised Signatory
`,
  },

  {
    name: 'Memorandum of Understanding',
    type: 'mou',
    content: `MEMORANDUM OF UNDERSTANDING

This Memorandum of Understanding ("MOU") is entered into as of {{date}} between:

Party A: {{party_a}}
Party B: {{party_b}}

1. NATURE OF THIS DOCUMENT
This MOU is a statement of intent and a framework for cooperation between the Parties. It is non-binding in its commercial terms except for Clauses 5 (Confidentiality) and 6 (Intellectual Property), which are legally binding. This MOU does not constitute a joint venture, partnership, or employment relationship.

2. OBJECTIVE
The Parties intend to collaborate on the following: {{objective}}

3. RESPONSIBILITIES

Party A ({{party_a}}): {{responsibilities_a}}

Party B ({{party_b}}): {{responsibilities_b}}

4. RESOURCE COMMITMENT
Each Party shall bear its own costs and expenses in connection with this MOU unless separately agreed in writing. No financial commitments are created by this document.

5. CONFIDENTIALITY (BINDING)
Both Parties agree to maintain the confidentiality of any proprietary or sensitive information shared in the course of this collaboration, and not to disclose such information to third parties without prior written consent of the other Party.

6. INTELLECTUAL PROPERTY (BINDING)
Any pre-existing intellectual property brought into the collaboration by either Party remains that Party's sole property. Any jointly developed intellectual property shall be owned jointly, and the terms of commercialisation shall be agreed in a subsequent binding agreement.

7. DURATION AND REVIEW
This MOU is effective from {{date}} for a period of {{duration}}. The Parties agree to review progress and the terms of this MOU at regular intervals and to communicate openly regarding any changes in circumstances.

8. TERMINATION
Either Party may terminate this MOU upon thirty (30) days' written notice to the other Party. Binding obligations under Clauses 5 and 6 survive termination for a period of two (2) years.

9. AMENDMENTS
This MOU may be amended only by mutual written agreement signed by authorised representatives of both Parties.

10. NOT A JOINT VENTURE
Nothing in this MOU shall be construed as creating a joint venture, agency, employment, or partnership relationship between the Parties.

11. GOVERNING LAW
This MOU and its binding provisions shall be governed by the laws of India, with exclusive jurisdiction in the courts of Chennai, Tamil Nadu.

Signed in good faith on {{date}}

{{party_a}}                         {{party_b}}
_________________________           _________________________
Authorised Signatory                Authorised Signatory
`,
  },

  {
    name: 'Client Onboarding Welcome Email',
    type: 'email',
    content: `Subject: Welcome to {{company_name}} — Your project begins {{start_date}}

Hi {{client_name}},

Welcome aboard. We're excited to start working with you and the team at your organisation.

Your project is scheduled to begin on {{start_date}}. Here's what to expect in the next few days:

WHAT HAPPENS NEXT

1. Kickoff Call — We'll schedule a brief call within the next 48 hours to align on objectives, introduce the team, and confirm scope. You'll receive a calendar invite shortly.

2. Project Brief — We'll share a formal Project Brief document outlining deliverables, timeline, and communication protocols for your review.

3. Access Setup — Where required, we'll share credentials or request access to relevant systems ahead of the start date.

YOUR POINT OF CONTACT

{{poc_name}} is your dedicated point of contact throughout this engagement.
Email: {{poc_email}}

For urgent matters, please reach out directly. We respond to all messages within 4 business hours.

COMMUNICATION CHANNELS

- Email for documentation, reports, and formal communications
- Scheduled check-in calls for project updates
- Shared project folder for file exchange (details shared at kickoff)

HOW TO RAISE CONCERNS

If at any point you have concerns about progress, quality, or anything else — please tell us immediately. We resolve issues faster when we hear about them early.

We look forward to delivering great work with you.

Warm regards,

{{company_name}} Team
`,
  },

  {
    name: 'Invoice Follow-up — Gentle (Day 3)',
    type: 'email',
    content: `Subject: Reminder: Invoice {{invoice_no}} — Due {{due_date}}

Hi {{client_name}},

I hope things are going well on your end.

I just wanted to make sure Invoice {{invoice_no}} for {{amount}} didn't get lost in the inbox. It's due on {{due_date}}.

If you've already processed the payment, please disregard this message — and thank you!

PAYMENT DETAILS

UPI: {{upi_id}}
Reference: {{invoice_no}}

If you have any questions about the invoice, need a revised copy, or would like to discuss payment, just reply to this email and we'll sort it out quickly.

Thank you for your continued trust in {{company_name}}.

Regards,

{{company_name}} Accounts
`,
  },

  {
    name: 'Invoice Follow-up — Firm (Day 7)',
    type: 'email',
    content: `Subject: Overdue: Invoice {{invoice_no}} — Action Required

Hi {{client_name}},

Invoice {{invoice_no}} for {{amount}}, which was due on {{due_date}}, is now {{days_overdue}} days overdue.

We understand delays happen, and we'd like to resolve this as smoothly as possible. Could you please let us know:

1. When we can expect payment, or
2. If there's an issue with the invoice that needs to be addressed

As per our agreement, a late payment fee of 1.5% per month applies to overdue balances. To avoid this, we'd appreciate payment at your earliest convenience.

PAYMENT DETAILS

UPI: {{upi_id}}
Reference: {{invoice_no}}

Please reply to this email or reach out to confirm your payment plan.

Regards,

{{company_name}} Accounts
`,
  },

  {
    name: 'Invoice Follow-up — Final Notice (Day 14)',
    type: 'email',
    content: `Subject: Final Notice: Invoice {{invoice_no}} — {{days_overdue}} Days Overdue

Hi {{client_name}},

This is a final notice regarding Invoice {{invoice_no}} for {{amount}}, originally due on {{due_date}} and now {{days_overdue}} days overdue.

Despite our previous reminders, we have not received payment or a response confirming a payment arrangement.

If payment is not received within 7 days of this notice, we will have no choice but to escalate this matter, which may include engaging a collections agency or initiating legal proceedings to recover the outstanding amount, along with applicable late fees and recovery costs.

We would much prefer to resolve this amicably and continue our working relationship.

PAYMENT DETAILS

UPI: {{upi_id}}
Reference: {{invoice_no}}

Please contact us immediately to arrange payment or discuss this matter.

Regards,

{{company_name}} Accounts
`,
  },

  {
    name: 'Project Kickoff Brief',
    type: 'onboarding',
    content: `PROJECT KICKOFF BRIEF

Project: {{project_name}}
Client: {{client_name}}
Date: {{date}}
Prepared by: {{company_name}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. PROJECT OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{project_name}} is a project to deliver the following outcomes:
{{objectives}}

This document serves as the single reference for project scope, team, and communication. All parties are expected to review and acknowledge this brief.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. DELIVERABLES AND ACCEPTANCE CRITERIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{deliverables}}

Acceptance: Client will confirm acceptance of each deliverable in writing within 7 business days of delivery. Silence constitutes acceptance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. TIMELINE AND MILESTONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{timeline}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. TEAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{team_members}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. COMMUNICATION PROTOCOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Primary channel: {{communication_channel}}
Response time SLA: All messages responded to within 4 business hours
Weekly status update: Shared every Friday by end of day
Escalation path: Project Lead → {{company_name}} Director → CEO

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. OUT OF SCOPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The following are explicitly out of scope for this engagement and will require a change order if required:
- Requirements not documented in the agreed GDD/Brief
- Post-go-live support beyond 30 days
- Third-party integrations not listed in deliverables
- Training beyond initial handover session

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. RISK REGISTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk 1: Delayed client feedback
Impact: Timeline extension
Mitigation: 7-day acceptance window; weekly check-ins

Risk 2: Scope creep
Impact: Budget overrun
Mitigation: All changes documented as formal change orders before work begins

Risk 3: Key personnel unavailability
Impact: Delivery delay
Mitigation: Cross-trained team; immediate notification of any absences exceeding 2 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Client to confirm this brief in writing (reply to the kickoff email)
2. Access provisioning (if required) — by Day 2
3. Development/delivery begins — Day 3

{{company_name}} · {{date}}
`,
  },
]

async function seed() {
  await client.connect()
  console.log('Connected to database')

  const res = await client.query(
    `SELECT id FROM companies WHERE name ILIKE '%etherence it%' LIMIT 1`
  )

  if (res.rows.length === 0) {
    console.error('Etherence IT company not found in DB. Run seed.js first.')
    process.exit(1)
  }

  const companyId = res.rows[0].id
  console.log(`Using company_id: ${companyId}`)

  let inserted = 0
  let skipped  = 0

  for (const t of TEMPLATES) {
    const variables = [...new Set((t.content.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.slice(2, -2)))]

    const exists = await client.query(
      `SELECT id FROM templates WHERE company_id = $1 AND name = $2`,
      [companyId, t.name]
    )

    if (exists.rows.length > 0) {
      console.log(`  SKIP (already exists): ${t.name}`)
      skipped++
      continue
    }

    await client.query(
      `INSERT INTO templates (company_id, name, type, content, variables, version)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [companyId, t.name, t.type, t.content, JSON.stringify(variables)]
    )

    console.log(`  INSERTED: ${t.name} (${t.type}) — ${variables.length} variables`)
    inserted++
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`)
  await client.end()
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
