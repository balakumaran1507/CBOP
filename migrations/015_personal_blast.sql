-- 015 — Personal blast mode for campaigns + daily send cap tracking

-- personal_mode = no List-Unsubscribe header, no unsubscribe footer.
-- Intended for transactional-style bulk sends (shortlist notifications, founder outreach).
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS personal_mode BOOLEAN NOT NULL DEFAULT FALSE;

-- pdf_attachment_path — optional PDF to attach to every email in the campaign.
-- Stored as a relative path under uploads/campaign-pdfs/.
ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS pdf_attachment_path TEXT;
