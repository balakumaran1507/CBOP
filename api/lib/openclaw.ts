/**
 * OpenClaw Integration
 * All messaging (Telegram, WhatsApp, Email) goes through OpenClaw
 * All AI agents are powered by OpenClaw
 */

export type NotificationChannel = 'telegram' | 'whatsapp' | 'email'

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
  context: Record<string, any>
  userId?: string
}

const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://127.0.0.1:18789'
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || ''

/**
 * Send a message via OpenClaw
 * Supports Telegram, WhatsApp, and Email
 */
export async function sendViaOpenClaw(payload: OpenClawSendPayload): Promise<void> {
  try {
    const response = await fetch(`${OPENCLAW_URL}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenClaw send failed: ${error}`)
    }

    console.log('✓ Message sent via OpenClaw:', {
      channel: payload.channel,
      to: payload.to.substring(0, 10) + '...',
    })
  } catch (error) {
    console.error('OpenClaw send error:', error)
    throw error
  }
}

/**
 * Trigger an AI agent via OpenClaw
 */
export async function triggerAgent(payload: OpenClawAgentPayload): Promise<any> {
  try {
    const response = await fetch(`${OPENCLAW_URL}/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENCLAW_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenClaw agent failed: ${error}`)
    }

    const result = await response.json()
    console.log('✓ Agent triggered via OpenClaw:', payload.agent)
    return result
  } catch (error) {
    console.error('OpenClaw agent error:', error)
    throw error
  }
}
