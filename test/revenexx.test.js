'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveContext, decodeClaims } = require('../src/revenexx');

/** Build a fake JWT (header.payload.signature) with the given claims. */
function jwtWith(claims) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

function ctx(headers, env = {}) {
    return resolveContext({ req: { headers } }, env);
}

test('resolves tenant from the verified JWT claim, not the header', () => {
    const c = ctx({
        'x-revenexx-jwt': jwtWith({ sub: 'user-1', tenant_id: 'acme', roles: ['user'] }),
        'x-revenexx-tenant': 'evil-corp', // header lies; claim wins
    });
    assert.equal(c.tenant, 'acme');
    assert.equal(c.actor.subject, 'user-1');
});

test('falls back to the tenant header only when the JWT carries no claim', () => {
    assert.equal(ctx({ 'x-revenexx-tenant': 'acme' }).tenant, 'acme');
});

test('anonymous call has null tenant and empty jwt', () => {
    const c = ctx({});
    assert.equal(c.tenant, null);
    assert.equal(c.jwt, '');
    assert.equal(c.trigger, 'http');
});

test('trigger is read from the header (schedule/admin/event)', () => {
    assert.equal(ctx({ 'x-revenexx-trigger': 'schedule' }).trigger, 'schedule');
});

test('isAdmin reflects role claim or admin trigger', () => {
    assert.equal(ctx({ 'x-revenexx-jwt': jwtWith({ roles: ['tenant-admin'] }) }).isAdmin(), true);
    assert.equal(ctx({ 'x-revenexx-trigger': 'admin' }).isAdmin(), true);
    assert.equal(ctx({ 'x-revenexx-jwt': jwtWith({ roles: ['user'] }) }).isAdmin(), false);
});

test('data() refuses without a tenant identity', () => {
    assert.throws(() => ctx({}).data('/x'), /no tenant identity/);
});

test('data() requires REVENEXX_DATA_ENDPOINT', () => {
    const c = ctx({ 'x-revenexx-jwt': jwtWith({ tenant_id: 'acme' }) }, {});
    assert.throws(() => c.data('/x'), /REVENEXX_DATA_ENDPOINT/);
});

test('decodeClaims tolerates garbage', () => {
    assert.deepEqual(decodeClaims('not-a-jwt'), {});
    assert.deepEqual(decodeClaims(''), {});
});
