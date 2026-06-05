/**
 * Sample App function entrypoint.
 *
 * A small REST router over the `greetings` entity, backed by @revenexx/app-sdk
 * (ADR-0057): the SDK's runtime adapter forwards the brokered per-tenant JWT to
 * PostgREST, so every row read/written is RLS-scoped to the caller's tenant.
 *
 *   POST   /greetings           create
 *   GET    /greetings           list (filter: locale, name, q; page: limit, offset, order)
 *   GET    /greetings/{id}      read one
 *   PUT    /greetings/{id}      update
 *   DELETE /greetings/{id}      delete
 *   GET    /digest              transform — aggregate + a derived "shout" view
 */

const { resolveContext } = require('./revenexx');
const { createDb, ENTITIES } = require('./db.generated');

/** Path params the gateway extracted from the route template (e.g. {id}). */
function pathParams(req) {
    try {
        return JSON.parse((req.headers || {})['x-capability-params'] || '{}');
    } catch {
        return {};
    }
}

/** The id for /greetings/{id} — prefer the gateway's param, fall back to the path. */
function resourceId(req) {
    const p = pathParams(req);
    if (p.id) return p.id;
    const parts = String(req.path || '').split('/').filter(Boolean);
    return parts[1] ?? null;
}

/** A tenant-scoped data client, or null when there's no identity / data plane. */
function dataClient(context, ctx) {
    if (!ctx.jwt || !process.env.REVENEXX_DATA_ENDPOINT) return null;
    return createDb({ adapter: 'runtime', context });
}

const INT = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
};

module.exports = async (context) => {
    const { req, res, log } = context;
    const ctx = resolveContext(context);
    const method = req.method;
    const path = (String(req.path || '/').replace(/\/+$/, '')) || '/';

    log(`sample-app ${method} ${path} — tenant=${ctx.tenant ?? 'none'} trigger=${ctx.trigger}${ctx.schedule ? ` schedule=${ctx.schedule}` : ''}`);

    // Scheduled tick (ADR-0058): one run per active tenant install.
    if (ctx.schedule) {
        return res.json({ scheduled: ctx.schedule, tenant: ctx.tenant, timestamp: new Date().toISOString() });
    }

    const db = dataClient(context, ctx);
    const needsData = () => {
        if (!db) {
            res.json({ error: 'data plane unavailable — this route needs a tenant identity and REVENEXX_DATA_ENDPOINT' }, 503);
            return false;
        }
        return true;
    };

    try {
        // --- POST /greetings — create -------------------------------------
        if (method === 'POST' && path === '/greetings') {
            const body = req.body || {};
            const name = body.name ?? 'world';
            const message = body.message ?? `Hello, ${name}!`;
            if (!db) {
                // No data plane (e.g. anonymous local hit): echo, don't persist.
                return res.json({ message, greeting: null, persisted: false }, 200);
            }
            const greeting = await db.greetings.create({
                name,
                message,
                ...(body.locale ? { locale: body.locale } : {}),
                ...(body.metadata ? { metadata: body.metadata } : {}),
            });
            return res.json({ message, greeting, persisted: true }, 201);
        }

        // --- GET /greetings — list (filter + paginate) --------------------
        if (method === 'GET' && path === '/greetings') {
            if (!needsData()) return;
            const q = req.query || {};
            const where = {};
            if (q.locale) where.locale = q.locale;
            if (q.name) where.name = q.name;
            if (q.q) where.name = { op: 'ilike', value: `%${q.q}%` }; // substring search

            const limit = Math.min(Math.max(INT(q.limit, 20), 1), 100);
            const offset = Math.max(INT(q.offset, 0), 0);
            const order = q.order || 'created_at.desc';

            const items = await db.greetings.list({ where, order, limit, offset });
            return res.json({
                items,
                page: { limit, offset, returned: items.length, hasMore: items.length === limit },
                filter: where,
            }, 200);
        }

        // --- GET /greetings/{id} — read one -------------------------------
        if (method === 'GET' && path.startsWith('/greetings/')) {
            if (!needsData()) return;
            const row = await db.greetings.get(resourceId(req));
            return row ? res.json(row, 200) : res.json({ error: 'not found' }, 404);
        }

        // --- PUT /greetings/{id} — update ---------------------------------
        if (method === 'PUT' && path.startsWith('/greetings/')) {
            if (!needsData()) return;
            const id = resourceId(req);
            const existing = await db.greetings.get(id);
            if (!existing) return res.json({ error: 'not found' }, 404);
            const body = req.body || {};
            const patch = {};
            for (const k of ['name', 'message', 'locale', 'metadata']) {
                if (body[k] !== undefined) patch[k] = body[k];
            }
            const updated = await db.greetings.update(id, patch);
            return res.json(updated, 200);
        }

        // --- DELETE /greetings/{id} — delete ------------------------------
        if (method === 'DELETE' && path.startsWith('/greetings/')) {
            if (!needsData()) return;
            const id = resourceId(req);
            const existing = await db.greetings.get(id);
            if (!existing) return res.json({ error: 'not found' }, 404);
            await db.greetings.delete(id);
            return res.json({ deleted: true, id }, 200);
        }

        // --- GET /digest — transform --------------------------------------
        // Reads the set and returns a derived view: totals per locale plus the
        // five most recent greetings rendered as an upper-cased "shout".
        if (method === 'GET' && path === '/digest') {
            if (!needsData()) return;
            const all = await db.greetings.list({ order: 'created_at.desc', limit: 1000 });
            const byLocale = {};
            for (const g of all) byLocale[g.locale] = (byLocale[g.locale] || 0) + 1;
            const shout = all.slice(0, 5).map((g) => ({
                id: g.id,
                shout: String(g.message ?? '').toUpperCase(),
                at: g.created_at,
            }));
            return res.json({ total: all.length, byLocale, shout, generatedAt: new Date().toISOString() }, 200);
        }

        return res.json({ error: 'route not found', method, path, entities: Object.keys(ENTITIES) }, 404);
    } catch (err) {
        log(`error on ${method} ${path}: ${err?.message ?? err}`);
        return res.json({ error: err?.message ?? String(err) }, 500);
    }
};
