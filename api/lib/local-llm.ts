const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:4b'

export interface LLMScore {
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  summary: string
  strengths: string[]
  gaps: string[]
  signals: {
    depth: number
    breadth: number
    practical: number
    communication: number
  }
}

const SCORE_PROMPT_TEMPLATE = `You are a technical hiring reviewer at a cybersecurity and software development firm. Evaluate this resume for the {{roleTitle}} role.

Required skills for this role: {{skills}}

Resume text:
{{resumeText}}

Score 0–100 based on QUALITY not quantity. Guidelines:
- DEPTH (0-10): Did they go deep? Show understanding beyond listing tool names? Build something non-trivial?
- BREADTH (0-10): Range of relevant skills with evidence of use
- PRACTICAL (0-10): Shipped real projects? Open source? Internship where they owned something end-to-end?
- COMMUNICATION (0-10): Is the resume clear, specific, and professional? (Not typos - substance clarity)

PENALIZE:
- Long skill lists with no project evidence
- Prize mentions without context (what competition, what ranking, how many teams)
- Generic project descriptions ("built a web app", "made a chatbot")
- Year 1/2 students with no substantial work outside coursework

REWARD:
- CTF write-ups, security research, CVEs, bug bounties
- Open source contributions with links
- Projects with actual users or production deployments
- Clear, specific achievement descriptions with numbers

Return ONLY valid JSON (no markdown fences, no preamble):
{"score":72,"grade":"B","summary":"3 sentences max narrative verdict","strengths":["strength 1","strength 2"],"gaps":["gap 1"],"signals":{"depth":7,"breadth":6,"practical":8,"communication":6}}`

export async function ollamaComplete(prompt: string, system?: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: OLLAMA_MODEL, prompt, system: system ?? '', stream: false }),
      signal:  controller.signal,
    })
    if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`)
    const data = await res.json() as { response: string }
    return data.response
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw new Error('Ollama request timed out after 60s')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function scoreResumeWithLLM(
  resumeText:     string,
  roleTitle:      string,
  requiredSkills: string[],
): Promise<LLMScore> {
  const prompt = SCORE_PROMPT_TEMPLATE
    .replace('{{roleTitle}}',  roleTitle)
    .replace('{{skills}}',     requiredSkills.join(', ') || 'general')
    .replace('{{resumeText}}', resumeText.slice(0, 4000))

  const raw = await ollamaComplete(prompt)

  // Direct parse
  try {
    return JSON.parse(raw.trim()) as LLMScore
  } catch { /* fall through to regex extraction */ }

  // Extract JSON block from response
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0]) as LLMScore
    } catch { /* fall through */ }
  }

  throw new Error(`Failed to parse Ollama score response: ${raw.slice(0, 300)}`)
}
