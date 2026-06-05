/**
 * revenexx App runtime context (PE-175 / ADR-0057) — reference helper.
 *
 * Resolves the per-invocation tenant context from the headers the platform
 * forwards (see ADR-0057 P1) and exposes a tenant-scoped data client. App code
 * stays tenant-agnostic: the tenant is an input, not a deploy artifact.
 *
 * Headers consumed (forwarded by the gateway → platform):
 *   x-revenexx-jwt      brokered Eimerkette identity (Bearer for PostgREST; RLS
 *                       keys off its verified tenant_id claim)
 *   x-revenexx-tenant   tenant slug (multi-tenant disambiguator)
 *   x-revenexx-trigger  http | schedule | admin | event
 *   x-capability-key    gateway capability/operationId (optional)
 *
 * This is the reference implementation; it is intended to be extracted into a
 * published @revenexx/app-runtime package (via packistry) once that home
 * exists — the contract below is what apps should code against.
 */

'use strict';

/** Lower-case header lookup that tolerates the runtime's header shape. */
function header(headers, name) {
    if (!headers) return '';
    const direct = headers[name] ?? headers[name.toLowerCase()];
    if (typeof direct === 'string') return direct;
    // Some runtimes expose headers as a Map or with mixed case.
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === name) return Array.isArray(v) ? (v[0] ?? '') : String(v ?? '');
    }
    return '';
}

/** Decode a JWT payload without verifying (verification happens at PostgREST). */
function decodeClaims(jwt) {
    if (!jwt || jwt.split('.').length < 2) return {};
    try {
        const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) || {};
    } catch {
        return {};
    }
}

/**
 * Build the runtime context from the function `context` (Appwrite open-runtimes
 * shape: { req: { headers }, ... }) and the process env.
 *
 * @param {{ req?: { headers?: Record<string,any> } }} fnContext
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveContext(fnContext, env = process.env) {
    const headers = (fnContext && fnContext.req && fnContext.req.headers) || {};
    const jwt = header(headers, 'x-revenexx-jwt');
    const claims = decodeClaims(jwt);

    // The verified source of truth is the JWT claim; the header only
    // disambiguates a multi-tenant token (and must be within tenant_ids).
    const claimTenant = typeof claims.tenant_id === 'string' ? claims.tenant_id : '';
    const headerTenant = header(headers, 'x-revenexx-tenant');
    const tenant = claimTenant || headerTenant || null;

    const roles = Array.isArray(claims.roles)
        ? claims.roles
        : (typeof claims.roles === 'string' ? claims.roles.split(/[ ,]+/).filter(Boolean) : []);

    // A scheduled tick carries X-Revenexx-Schedule (the manifest schedule name,
    // ADR-0058) so a multi-schedule App can branch on which job fired. Its
    // presence also implies the trigger is a schedule when the runtime didn't
    // set x-revenexx-trigger.
    const schedule = header(headers, 'x-revenexx-schedule') || null;
    const trigger = header(headers, 'x-revenexx-trigger') || (schedule ? 'schedule' : 'http');

    return {
        /** Resolved tenant slug, or null for an anonymous / tenant-neutral call. */
        tenant,
        /** Brokered JWT (empty string when anonymous). */
        jwt,
        /** Caller identity derived from the verified-downstream JWT claims. */
        actor: {
            subject: typeof claims.sub === 'string' ? claims.sub : null,
            orgId: typeof claims.org_id === 'string' ? claims.org_id : null,
            roles,
        },
        /** What triggered this invocation: http | schedule | admin | event. */
        trigger,
        /** Manifest schedule name when this is a scheduled tick, else null. */
        schedule,
        /** Gateway capability/operationId, when routed through the gateway. */
        capability: header(headers, 'x-capability-key') || null,

        /** True when the caller carries the tenant-admin role for this tenant. */
        isAdmin() {
            return roles.includes('admin') || roles.includes('tenant-admin') || trigger === 'admin';
        },

        /**
         * Tenant-scoped PostgREST client: forwards the brokered JWT so RLS +
         * baseline.check_app_access() scope to this tenant. Requires the data
         * endpoint via env (REVENEXX_DATA_ENDPOINT). Throws when there is no
         * tenant identity — a tenant-neutral call must not touch tenant data.
         *
         * @param {string} path  PostgREST path, e.g. "/revenexx__products__products"
         * @param {RequestInit} [init]
         */
        data(path, init = {}) {
            if (!jwt) {
                throw new Error('revenexx: no tenant identity on this invocation — cannot access tenant data.');
            }
            const base = (env.REVENEXX_DATA_ENDPOINT || '').replace(/\/$/, '');
            if (!base) {
                throw new Error('revenexx: REVENEXX_DATA_ENDPOINT is not configured.');
            }
            const h = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwt}`,
                ...(tenant ? { 'X-Revenexx-Tenant': tenant } : {}),
                ...(init.headers || {}),
            };
            return fetch(`${base}${path}`, { ...init, headers: h });
        },
    };
}

module.exports = { resolveContext, decodeClaims };
