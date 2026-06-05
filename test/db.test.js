'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// The client generated from this App's schema.json + manifest.json by
// `appsdk generate`, running on the published @revenexx/app-sdk runtime.
const { createDb, ENTITIES } = require('../src/db.generated');

test('generated client maps greetings to its namespaced table', () => {
    assert.equal(ENTITIES.greetings.table, 'revenexx__sample_app__greetings');
    assert.equal(ENTITIES.greetings.pk, 'id');
});

test('mock adapter: create applies schema defaults, then list/get round-trip', async () => {
    const db = createDb({ adapter: 'mock', seed: {} });

    const g = await db.greetings.create({ name: 'Max' });
    assert.ok(g.id, 'pk generated');
    assert.equal(g.message, 'Hello'); // schema default
    assert.equal(g.locale, 'en'); //     schema default

    assert.equal((await db.greetings.list()).length, 1);
    assert.equal((await db.greetings.get(g.id)).name, 'Max');
});

test('remote adapter forwards the brokered JWT + tenant to PostgREST (ADR-0057)', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, method: opts.method, auth: opts.headers.Authorization, tenant: opts.headers['X-Revenexx-Tenant'] });
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'r1', name: 'Max', message: 'Hi', locale: 'en' }]) };
    };

    const db = createDb({
        adapter: 'remote',
        endpoint: 'https://data.revenexx.com/',
        token: 'brokered.jwt.sig', // the X-Revenexx-Context identity
        tenant: 'revenexx',
        fetchImpl,
    });

    const rows = await db.greetings.list({ where: { locale: 'en' }, limit: 10 });
    assert.equal(rows[0].name, 'Max');
    assert.match(calls[0].url, /\/revenexx__sample_app__greetings\?locale=eq\.en&limit=10$/);
    assert.equal(calls[0].auth, 'Bearer brokered.jwt.sig');
    assert.equal(calls[0].tenant, 'revenexx');
});
