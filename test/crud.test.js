'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const handler = require('../src/main');

// --- a minimal in-memory PostgREST, wired in via global fetch ---------------
// Implements just enough of the surface the SDK's remote adapter uses:
// GET (filter/order/limit/offset), POST (insert + defaults), PATCH, DELETE.
let store = [];

function fakePostgrest(url, opts) {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const table = u.pathname.split('/').filter(Boolean).pop();
    assert.equal(table, 'revenexx__sample_app__greetings');
    const body = opts.body ? JSON.parse(opts.body) : null;
    const idEq = (u.searchParams.get('id') || '').replace(/^eq\./, '');

    const ok = (rows) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) });

    if (method === 'GET') {
        let rows = store.slice();
        for (const [k, v] of u.searchParams) {
            if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
            if (v.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === v.slice(3));
            else if (v.startsWith('ilike.')) {
                const re = new RegExp('^' + v.slice(6).replace(/%/g, '.*') + '$', 'i');
                rows = rows.filter((r) => re.test(String(r[k])));
            }
        }
        const order = u.searchParams.get('order');
        if (order) {
            const [c, dir = 'asc'] = order.split('.');
            rows.sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0));
            if (dir === 'desc') rows.reverse();
        }
        const offset = parseInt(u.searchParams.get('offset') || '0', 10);
        const limit = u.searchParams.get('limit') ? parseInt(u.searchParams.get('limit'), 10) : undefined;
        rows = rows.slice(offset, limit !== undefined ? offset + limit : undefined);
        return ok(rows);
    }
    if (method === 'POST') {
        const row = {
            id: crypto.randomUUID(),
            locale: 'en',
            metadata: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tenant_id: 'revenexx',
            ...body,
        };
        store.push(row);
        return ok([row]);
    }
    if (method === 'PATCH') {
        const i = store.findIndex((r) => r.id === idEq);
        store[i] = { ...store[i], ...body, updated_at: new Date().toISOString() };
        return ok([store[i]]);
    }
    if (method === 'DELETE') {
        store = store.filter((r) => r.id !== idEq);
        return { ok: true, status: 204, text: async () => '' };
    }
    return { ok: false, status: 500, text: async () => 'unhandled' };
}

// A brokered context: a JWT carrying tenant_id so resolveContext sets ctx.jwt.
function jwt(claims) {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b({ alg: 'RS256' })}.${b(claims)}.sig`;
}

function call(method, path, { query = {}, body = null, params = {} } = {}) {
    let captured;
    const ctx = {
        req: {
            method,
            path,
            query,
            body,
            headers: {
                'x-revenexx-context': jwt({ sub: 'svc-1', tenant_id: 'revenexx', roles: ['user'] }),
                'x-revenexx-tenant': 'revenexx',
                'x-capability-params': JSON.stringify(params),
            },
        },
        res: { json: (b, code = 200) => { captured = { body: b, code }; return captured; } },
        log: () => {},
    };
    return handler(ctx).then(() => captured);
}

beforeEach(() => {
    store = [];
    globalThis.fetch = fakePostgrest;
    process.env.REVENEXX_DATA_ENDPOINT = 'https://apps.api.revenexx.com/';
});
afterEach(() => { delete process.env.REVENEXX_DATA_ENDPOINT; });

test('POST /greetings creates and persists a tenant-scoped row', async () => {
    const r = await call('POST', '/greetings', { body: { name: 'Max' } });
    assert.equal(r.code, 201);
    assert.equal(r.body.message, 'Hello, Max!');
    assert.equal(r.body.greeting.name, 'Max');
    assert.equal(r.body.greeting.locale, 'en');
    assert.equal(r.body.greeting.tenant_id, 'revenexx');
});

test('GET /greetings/{id} reads one; 404 when missing', async () => {
    const created = (await call('POST', '/greetings', { body: { name: 'Ann' } })).body.greeting;
    const got = await call('GET', `/greetings/${created.id}`, { params: { id: created.id } });
    assert.equal(got.code, 200);
    assert.equal(got.body.name, 'Ann');

    const miss = await call('GET', '/greetings/nope', { params: { id: 'nope' } });
    assert.equal(miss.code, 404);
});

test('PUT /greetings/{id} updates; DELETE removes', async () => {
    const g = (await call('POST', '/greetings', { body: { name: 'Bob' } })).body.greeting;

    const upd = await call('PUT', `/greetings/${g.id}`, { params: { id: g.id }, body: { message: 'Hi Bob' } });
    assert.equal(upd.code, 200);
    assert.equal(upd.body.message, 'Hi Bob');

    const del = await call('DELETE', `/greetings/${g.id}`, { params: { id: g.id } });
    assert.equal(del.code, 200);
    assert.deepEqual(del.body, { deleted: true, id: g.id });

    assert.equal((await call('GET', `/greetings/${g.id}`, { params: { id: g.id } })).code, 404);
});

test('GET /greetings filters by locale and paginates a large set', async () => {
    for (let i = 0; i < 50; i++) {
        await call('POST', '/greetings', { body: { name: `u${i}`, locale: i % 2 ? 'de' : 'en' } });
    }
    const en = await call('GET', '/greetings', { query: { locale: 'en' } });
    assert.equal(en.body.items.length, 20); // default limit
    assert.ok(en.body.items.every((g) => g.locale === 'en'));
    assert.equal(en.body.page.hasMore, true);

    const page2 = await call('GET', '/greetings', { query: { locale: 'en', limit: '10', offset: '20' } });
    assert.equal(page2.body.page.offset, 20);
    assert.equal(page2.body.items.length, 5); // 25 'en' rows total → offset 20 leaves 5
    assert.equal(page2.body.page.hasMore, false);
});

test('GET /digest transforms the set (totals per locale + upper-cased shout)', async () => {
    await call('POST', '/greetings', { body: { name: 'x', locale: 'en', message: 'hello' } });
    await call('POST', '/greetings', { body: { name: 'y', locale: 'de', message: 'hallo' } });

    const d = await call('GET', '/digest');
    assert.equal(d.code, 200);
    assert.equal(d.body.total, 2);
    assert.deepEqual(d.body.byLocale, { en: 1, de: 1 });
    assert.ok(d.body.shout.some((s) => s.shout === 'HELLO' || s.shout === 'HALLO'));
});

test('data routes degrade to 503 without a data endpoint', async () => {
    delete process.env.REVENEXX_DATA_ENDPOINT;
    const r = await call('GET', '/greetings');
    assert.equal(r.code, 503);
});
