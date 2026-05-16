// Augments Hono's ContextVariableMap so c.get('userId') etc. are typed
// Import this in any file that calls c.get() on auth-injected variables.
import 'hono'

declare module 'hono' {
  interface ContextVariableMap {
    userId: string
    role: string
    companyIds: string[]
  }
}

export {}
