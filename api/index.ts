import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.NEXT_PUBLIC_APP_URL || '']
    : ['http://localhost:3003'],
  credentials: true,
}))

// Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cbop-api'
  })
})

// Routes will be added in later slices
// app.route('/api/auth', authRoutes)
// app.route('/api/deals', dealsRoutes)
// app.route('/api/invoices', invoicesRoutes)
// app.route('/api/tasks', tasksRoutes)
// app.route('/api/projects', projectsRoutes)
// app.route('/api/leads', leadsRoutes)
// app.route('/api/clients', clientsRoutes)
// app.route('/api/templates', templatesRoutes)
// app.route('/api/finance', financeRoutes)
// app.route('/api/settings', settingsRoutes)
// app.route('/api/agents', agentsRoutes)
// app.route('/webhooks', webhooksRoutes)

export default app
