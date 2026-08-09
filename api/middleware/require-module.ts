import { Context, Next } from 'hono'
import { ModuleKey } from '../lib/modules'
import { AUDIT_ACTIONS, writeAuthzDenial } from '../lib/audit-log'
import '../lib/hono-vars'

/**
 * Module-based access middleware. Must be used after requireAuth.
 *
 * Checks two things in order, and the two failures are deliberately *different*
 * status codes so the UI can tell "ask your admin" from "buy this":
 *  1. Role permission: is the module in the user's allowedModules list?
 *     (loaded from role_module_access in requireAuth; creator always passes)
 *     → 403 Forbidden. Permission failure; a plan upgrade would not help.
 *  2. Company module toggle: is the module enabled for the user's company?
 *     (loaded from company_modules in requireAuth; creator is exempt)
 *     → 402 Payment Required, body { error: 'module_not_enabled', module }.
 *     Entitlement failure; the role is fine, the company isn't subscribed/enabled.
 *
 * allowedModules is populated by requireAuth from:
 *   - role_module_access (post-migration 057 users with company_role_id)
 *   - static MODULES registry (pre-057 users without company_role_id, backward compat)
 *
 * Usage:
 *   app.get('/api/blog', requireAuth, requireModule('blog'), handler)
 */
export function requireModule(module: ModuleKey) {
  return async (c: Context, next: Next) => {
    const role = c.get('role')

    if (!role) {
      return c.json({ error: 'No role in context. requireAuth middleware missing?' }, 500)
    }

    // Creator bypasses everything — sacred rule, never remove this
    if (role === 'creator') return next()

    // Role permission check — is this module in the user's allowed list?
    const allowedModules: string[] = c.get('allowedModules') ?? []
    if (!allowedModules.includes(module)) {
      writeAuthzDenial(c, {
        action:       AUDIT_ACTIONS.authzModuleDenied,
        reason:       'role_not_permitted_on_module',
        resourceType: 'module',
        resourceId:   module,
        detail:       { module, allowed_modules: allowedModules },
      })
      return c.json({ error: `Forbidden: your role does not have access to the ${module} module` }, 403)
    }

    // Company module toggle — is this module enabled for the company?
    // This is an *entitlement* failure, not a permission failure: the role is
    // allowed, the company just doesn't have the module turned on. 402 lets the
    // frontend show "this needs a plan upgrade / ask an admin to enable it"
    // instead of the generic 403 "you don't have access" wall.
    const enabledModules: string[] = c.get('enabledModules') ?? []
    if (!enabledModules.includes(module)) {
      writeAuthzDenial(c, {
        action:       AUDIT_ACTIONS.authzModuleDenied,
        reason:       'module_not_enabled_for_company',
        resourceType: 'module',
        resourceId:   module,
        detail:       { module, enabled_modules: enabledModules },
      })
      return c.json({
        error:   'module_not_enabled',
        module,
        message: `${module} module is disabled for your company`,
      }, 402)
    }

    await next()
  }
}
