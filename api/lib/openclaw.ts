// Messaging + agent layer - calls cbop-bridge (port 18790) which proxies to OpenClaw (port 18789)
// OpenClaw (Nila) handles Telegram, WhatsApp, Discord, Slack and AI agent execution.

export type NotificationChannel = 'telegram' | 'whatsapp' | 'discord' | 'slack' | 'email'

export interface OpenClawSendPayload {
  channel: NotificationChannel
  to: string
  message?: string
  template?: string
  vars?: Record<string, string>
  attachment?: Buffer
}

export interface OpenClawAgentPayload {
  agent: string
  context: Record<string, unknown>
  userId?: string
}

const OPENCLAW_URL     = process.env.OPENCLAW_URL     || process.env.HERMES_URL     || 'http://127.0.0.1:18790'
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || process.env.HERMES_API_KEY || ''

export async function sendViaOpenClaw(payload: OpenClawSendPayload): Promise<void> {
  const response = await fetch(`${OPENCLAW_URL}/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENCLAW_API_KEY}` },
    body:    JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`OpenClaw send failed: ${await response.text()}`)
}

export async function triggerAgent(payload: OpenClawAgentPayload): Promise<unknown> {
  const response = await fetch(`${OPENCLAW_URL}/agent`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENCLAW_API_KEY}` },
    body:    JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`OpenClaw agent failed: ${await response.text()}`)
  return response.json()
}

export async function openClawComplete(prompt: string, systemPrompt?: string): Promise<string> {
  const response = await fetch(`${OPENCLAW_URL}/complete`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENCLAW_API_KEY}` },
    body:    JSON.stringify({ prompt, system: systemPrompt }),
  })
  if (!response.ok) throw new Error(`OpenClaw complete failed: ${await response.text()}`)
  const data = await response.json() as { text?: string; content?: string; response?: string }
  return data.text ?? data.content ?? data.response ?? ''
}
