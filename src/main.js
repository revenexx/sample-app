/**
 * Sample App function entrypoint.
 *
 * Reference scaffold for a revenexx App. Renders a greeting and echoes the
 * resolved per-invocation tenant context (PE-175 / ADR-0057) so the end-to-end
 * tenant flow can be smoke-tested: tenant A in → tenant A, tenant B in →
 * tenant B. Real domain logic scopes data via `ctx.data(...)`.
 */

const { resolveContext } = require('./revenexx');
// Typed data client generated from this App's schema.json + manifest.json,
// running on the published @revenexx/app-sdk runtime (`appsdk generate`).
const { createDb, ENTITIES } = require('./db.generated');

module.exports = async (context) => {
    const { req, res, log } = context;
    const ctx = resolveContext(context);

    log(`sample-app hit by ${req.method} ${req.path} — tenant=${ctx.tenant ?? 'none'} trigger=${ctx.trigger}${ctx.schedule ? ` schedule=${ctx.schedule}` : ''}`);

    // Scheduled tick (ADR-0058): the platform scheduler fans out one run per
    // active tenant install, each carrying that tenant's brokered identity +
    // the schedule name. Branch on it so a multi-schedule App can do per-job work.
    if (ctx.schedule) {
        log(`scheduled run '${ctx.schedule}' for tenant=${ctx.tenant ?? 'none'}`);
        return res.json({
            scheduled: ctx.schedule,
            tenant: ctx.tenant,
            timestamp: new Date().toISOString(),
        });
    }

    const name = req.query?.name ?? req.body?.name ?? 'world';

    // End-to-end data path (ADR-0057): when this invocation carries a brokered
    // tenant identity and the data plane is configured, persist the greeting via
    // the SDK's runtime adapter — it forwards ctx.jwt as the PostgREST Bearer so
    // RLS scopes the write to this tenant. Falls back to a plain echo otherwise
    // (e.g. an anonymous local hit), so the smoke test still works everywhere.
    let greeting = null;
    let dataError = null;
    if (ctx.jwt && process.env.REVENEXX_DATA_ENDPOINT) {
        try {
            const db = createDb({ adapter: 'runtime', context });
            greeting = await db.greetings.create({ name, message: `Hello, ${name}!` });
        } catch (err) {
            dataError = err?.message ?? String(err);
            log(`sdk data write failed: ${dataError}`);
        }
    }

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
            schedule: ctx.schedule,
            subject: ctx.actor.subject,
            isAdmin: ctx.isAdmin(),
        },
        // Proves the published @revenexx/app-sdk loaded in the deployed runtime;
        // `greeting` is the row persisted through PostgREST when the data path ran.
        sdk: {
            runtime: '@revenexx/app-sdk',
            entities: Object.keys(ENTITIES),
            greeting,
            dataError,
        },
        timestamp: new Date().toISOString(),
    });
};
