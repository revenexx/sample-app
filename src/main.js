/**
 * Sample App function entrypoint.
 *
 * Reference scaffold for a revenexx App. Renders a greeting and echoes the
 * resolved per-invocation tenant context (PE-175 / ADR-0057) so the end-to-end
 * tenant flow can be smoke-tested: tenant A in → tenant A, tenant B in →
 * tenant B. Real domain logic scopes data via `ctx.data(...)`.
 */

const { resolveContext } = require('./revenexx');

module.exports = async (context) => {
    const { req, res, log } = context;
    const ctx = resolveContext(context);

    log(`sample-app hit by ${req.method} ${req.path} — tenant=${ctx.tenant ?? 'none'} trigger=${ctx.trigger}`);

    const name = req.query?.name ?? req.body?.name ?? 'world';

    return res.json({
        message: `Hello, ${name}!`,
        app: {
            id: process.env.REVENEXX_APP_ID ?? null,
            name: process.env.REVENEXX_APP_NAME ?? null,
            deployment: process.env.REVENEXX_APP_DEPLOYMENT ?? null,
            runtime: `${process.env.REVENEXX_APP_RUNTIME_NAME ?? ''}-${process.env.REVENEXX_APP_RUNTIME_VERSION ?? ''}`,
        },
        caller: {
            tenant: ctx.tenant,
            trigger: ctx.trigger,
            subject: ctx.actor.subject,
            isAdmin: ctx.isAdmin(),
        },
        timestamp: new Date().toISOString(),
    });
};
