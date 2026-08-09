-- Migration 017: Per-company hiring settings

CREATE TABLE IF NOT EXISTS hiring_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID UNIQUE NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rejection_delay_hours    INT  NOT NULL DEFAULT 48,
  auto_reject_below        INT  NOT NULL DEFAULT 25,
  auto_shortlist_above     INT  NOT NULL DEFAULT 75,
  slack_invite_url         TEXT,
  discord_invite_url       TEXT,
  google_calendar_id       TEXT,
  rejection_email_template TEXT NOT NULL DEFAULT E'Hi {{applicant_name}},\n\nThank you for applying for the {{role_title}} position at {{company_name}}.\n\nAfter reviewing your application, we will not be moving forward at this time.\n\nWe encourage you to continue building your skills and apply again in the future.\n\nBest,\n{{company_name}} Team',
  interview_email_template TEXT NOT NULL DEFAULT E'Hi {{applicant_name}},\n\nWe reviewed your application for {{role_title}} and would like to invite you for an interview.\n\nDate: {{interview_date}}\nTime: {{interview_time}} IST\nMeeting Link: {{meet_link}}\n\nPlease confirm your attendance by replying to this email.\n\nBest,\n{{interviewer_name}}\n{{company_name}}',
  offer_email_template     TEXT NOT NULL DEFAULT E'Hi {{applicant_name}},\n\nWe are pleased to offer you an internship position as {{role_title}} at {{company_name}}.\n\nPlease find the offer letter attached. Review the terms and reply:\n- "I ACCEPT" to confirm your joining\n- "I DECLINE" if you wish to withdraw\n\nThe offer expires in 48 hours.\n\nWelcome aboard,\n{{company_name}} Team',
  welcome_email_template   TEXT NOT NULL DEFAULT E'Hi {{applicant_name}},\n\nWelcome to the team! We are excited to have you join us as {{role_title}}.\n\nYour start date: {{start_date}}\nYour team lead: {{team_lead_name}}\nReporting to: {{team_lead_email}}\n\nYou will receive separate invites for:\n- Slack workspace\n- Discord server\n- Wiki / documentation access\n\nSee you soon,\n{{company_name}} Team',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default settings for every existing company
INSERT INTO hiring_settings (company_id)
SELECT id FROM companies
ON CONFLICT (company_id) DO NOTHING;
