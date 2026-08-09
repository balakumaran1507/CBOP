-- Document Studio: templates, batch jobs, generated documents

CREATE TABLE document_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id),
  name             TEXT NOT NULL,
  doc_type         TEXT NOT NULL CHECK (doc_type IN ('offer_letter', 'certificate', 'custom')),
  background_path  TEXT,
  canvas_width     INT NOT NULL DEFAULT 794,
  canvas_height    INT NOT NULL DEFAULT 1123,
  elements         JSONB NOT NULL DEFAULT '[]',
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID REFERENCES document_templates(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','generating','done','failed')) DEFAULT 'pending',
  total_count   INT DEFAULT 0,
  done_count    INT DEFAULT 0,
  send_email    BOOLEAN DEFAULT false,
  error_message TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_generated (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID REFERENCES document_batches(id) ON DELETE CASCADE,
  template_id     UUID REFERENCES document_templates(id),
  recipient_name  TEXT,
  recipient_email TEXT,
  recipient_data  JSONB DEFAULT '{}',
  pdf_path        TEXT,
  email_sent      BOOLEAN DEFAULT false,
  email_sent_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_batches_template ON document_batches(template_id);
CREATE INDEX idx_document_generated_batch  ON document_generated(batch_id);
