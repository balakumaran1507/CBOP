import { ollamaComplete, scoreResumeWithLLM } from './local-llm'

export type { LLMScore } from './local-llm'
export { scoreResumeWithLLM }

// ── Interfaces - kept for backward compat (hiring.ts still reads ResumeData fields) ──

export interface ResumeProject {
  name: string
  description: string
  url?: string
  complexity: 'basic' | 'intermediate' | 'advanced'
}

export interface ResumePrize {
  name: string
  type: 'ctf' | 'hackathon' | 'competition' | 'certification'
  significance: 'major' | 'minor'
}

export interface ResumeExperience {
  role: string
  company: string
  months: number
  relevant: boolean
}

export interface ResumeData {
  skills: string[]
  projects: ResumeProject[]
  prizes: ResumePrize[]
  experience: ResumeExperience[]
  year_of_study: number | null
  is_final_year: boolean
  open_source_contributions: boolean
  college?: string | null
  phone?: string | null
  github_url?: string | null
  linkedin_url?: string | null
  portfolio_url?: string | null
}

// Kept for any code that still type-checks against the old breakdown shape
export interface ScoreBreakdown {
  skills_score: number
  projects_score: number
  prizes_score: number
  experience_score: number
  year_penalty: number
  total: number
  matched_skills: string[]
  missing_skills: string[]
  flags: string[]
}

const EMPTY_RESUME: ResumeData = {
  skills: [], projects: [], prizes: [], experience: [],
  year_of_study: null, is_final_year: false, open_source_contributions: false,
}

// ── extractResumeData ─────────────────────────────────────────────────────────
// Pulls contact/meta fields (college, phone, github, etc.) from raw resume text.
// Used by the score endpoint to backfill applicant contact details.
// If Ollama is unreachable, returns EMPTY_RESUME - caller should handle gracefully.

export async function extractResumeData(resumeText: string, roleTitle: string): Promise<ResumeData> {
  const prompt = `Role being applied for: ${roleTitle}

Resume/email text:
${resumeText.slice(0, 4000)}

Extract and return ONLY valid JSON with this exact structure (no other text):
{
  "skills": ["skill1", "skill2"],
  "projects": [{"name":"...","description":"...","url":"...","complexity":"basic|intermediate|advanced"}],
  "prizes": [{"name":"...","type":"ctf|hackathon|competition|certification","significance":"major|minor"}],
  "experience": [{"role":"...","company":"...","months":6,"relevant":true}],
  "year_of_study": 3,
  "is_final_year": false,
  "open_source_contributions": false,
  "college": "Name of college/university or null",
  "phone": "phone number or null",
  "github_url": "https://github.com/... or null",
  "linkedin_url": "https://linkedin.com/... or null",
  "portfolio_url": "portfolio/personal website URL or null"
}`

  try {
    const raw = await ollamaComplete(
      prompt,
      'Extract structured data from this resume. Return ONLY valid JSON, no other text.',
    )
    const cleaned = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(cleaned) as ResumeData
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[resume-scorer] extractResumeData failed: ${msg}`)
    return EMPTY_RESUME
  }
}

// ── extractStatedRole ─────────────────────────────────────────────────────────

export async function extractStatedRole(resumeText: string): Promise<string | null> {
  try {
    const raw = await ollamaComplete(
      `From this applicant email/resume, extract the exact internship role/position they are applying for. Reply with ONLY the role title (e.g. "Full Stack Developer") or "unknown" if not mentioned.\n\n${resumeText.slice(0, 1500)}`,
      'Reply with only the role title or "unknown".',
    )
    const result = raw.trim()
    return result.toLowerCase() === 'unknown' ? null : result
  } catch {
    return null
  }
}

// ── suggestRoleForApplicant ───────────────────────────────────────────────────

export async function suggestRoleForApplicant(
  resumeText: string,
  roles:       { id: string; title: string; required_skills: string[] }[],
  statedRole?: string | null,
): Promise<string | null> {
  if (!roles.length) return null

  if (statedRole) {
    const lower     = statedRole.toLowerCase()
    const nameMatch = roles.find((r) =>
      r.title.toLowerCase().includes(lower) ||
      lower.includes(r.title.toLowerCase().replace(/ intern(ship)?/i, '').trim()),
    )
    if (nameMatch) return nameMatch.id
  }

  const roleList = roles.map((r, i) =>
    `${i + 1}. ${r.title} (skills: ${(r.required_skills || []).join(', ') || 'general'})`,
  ).join('\n')

  const hint = statedRole ? `\nThe applicant stated they want: "${statedRole}"\n` : ''

  const prompt = `Applicant email/resume:
${resumeText.slice(0, 2000)}
${hint}
Available internship roles:
${roleList}

Which role number best matches this applicant? Reply with ONLY the number (e.g. "2"), or "0" if none match.`

  try {
    const raw = await ollamaComplete(prompt, 'You are a hiring assistant. Reply with only a single number.')
    const num = parseInt(raw.trim(), 10)
    if (num > 0 && num <= roles.length) return roles[num - 1].id
    return null
  } catch {
    return null
  }
}

// ── generateAINarrativeSummary ────────────────────────────────────────────────
// Kept for any callers that still import it. With Ollama scoring the summary is
// already returned by scoreResumeWithLLM - this is a lightweight fallback.

export async function generateAINarrativeSummary(
  resumeText: string,
  roleTitle:  string,
): Promise<string> {
  const prompt = `You are a technical hiring reviewer. Write a 3-sentence verdict for this applicant applying for ${roleTitle}.

Resume:
${resumeText.slice(0, 2000)}

Write exactly 3 sentences: (1) overall impression, (2) strongest point, (3) biggest gap or concern. Be direct and specific.`

  try {
    return (await ollamaComplete(prompt, 'Write exactly 3 sentences, no bullet points.')).trim()
  } catch {
    return 'AI summary unavailable - Ollama offline.'
  }
}

// ── generateApplicantSummary ──────────────────────────────────────────────────
// Legacy rule-based summary - kept so callers compile, but no longer used in main flow.

export function generateApplicantSummary(data: ResumeData, breakdown: ScoreBreakdown): string {
  const level =
    breakdown.total >= 75 ? 'Strong' :
    breakdown.total >= 50 ? 'Average' :
    breakdown.total >= 25 ? 'Weak' :
                            'Auto-reject'
  const skills   = breakdown.matched_skills.slice(0, 3).join(', ') || 'no core skills matched'
  const projects = data.projects.length
  const prizes   = data.prizes.length
  return `${level} (${breakdown.total}/100) - ${skills} - ${projects} project${projects !== 1 ? 's' : ''} - ${prizes} prize${prizes !== 1 ? 's' : ''}${breakdown.flags.length ? ' - ' + breakdown.flags[0] : ''}`
}
