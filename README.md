# sample-app

Reference scaffold for a revenexx App. A minimal hello-world function used to
smoke-test the App Registry runtime end-to-end (manifest validation → build →
register → deploy → execute).

## Layout

| Path             | Purpose                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `manifest.json`  | App contract — identity, permissions, events, policies. Validated against revenexx-console at deploy time. |
| `billing.json`   | Marketplace pricing/distribution. `type: free` → no Chargebee plan needed.            |
| `schema.json`    | Baseline schema contract — declares the Postgres tables this App needs. Optional; absent means the App needs no managed DB tables. |
| `src/main.js`    | The function entrypoint. Appwrite-style `module.exports = async (context) => …`.      |
| `package.json`   | Node package manifest. Pinned to Node 22+.                                            |

## API

A small REST surface over the `greetings` entity, backed by `@revenexx/app-sdk`
(every read/write is RLS-scoped to the caller's tenant via the brokered JWT):

| Method · Path            | Capability          | Notes |
| ------------------------ | ------------------- | ----- |
| `POST /greetings`        | `greetings.create`  | Body `{ name, message?, locale?, metadata? }` → persisted row |
| `GET /greetings`         | `greetings.list`    | Filter: `?locale=`, `?name=`, `?q=` (name substring). Page: `?limit=` (≤100), `?offset=`, `?order=` (e.g. `created_at.desc`) |
| `GET /greetings/{id}`    | `greetings.get`     | One row, or 404 |
| `PUT /greetings/{id}`    | `greetings.update`  | Body fields to patch |
| `DELETE /greetings/{id}` | `greetings.delete`  | `{ deleted, id }` |
| `GET /digest`            | `greetings.digest`  | Transform — totals per locale + the 5 latest as an upper-cased "shout" |

Through the gateway these are `https://api.revenexx.com/v1/...` (the API key must
hold a scope covering the capability, e.g. `greetings.*`).

## Deploy

```sh
# Pack the source the way the build worker expects it.
tar --exclude='./node_modules' --exclude='./.git' -czf sample-app.tar.gz .

# Create the App row (one-time):
curl -X POST https://app.revenexx.com/v1/apps \
  -H "X-Revenexx-Project: revenexx" \
  -H "X-Revenexx-Key: $REVENEXX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"functionId":"unique()","name":"sample-app","runtime":"node-22"}'

# Then push the deployment (replace :appId with the returned $id, set entrypoint
# to src/main.js; commands runs npm install because this App depends on the SDK).
curl -X POST https://app.revenexx.com/v1/apps/:appId/deployments \
  -H "X-Revenexx-Project: revenexx" \
  -H "X-Revenexx-Key: $REVENEXX_KEY" \
  -F "code=@sample-app.tar.gz" \
  -F "entrypoint=src/main.js" \
  -F "commands=npm install" \
  -F "activate=true"
```

> **Private dependency.** This App depends on `@revenexx/app-sdk`, published
> private to **GitHub Packages**. `.npmrc` routes the `@revenexx` scope there;
> GitHub Packages requires a token even for public packages, so the build worker
> must expose `NODE_AUTH_TOKEN` (a token with `read:packages`) for `npm install`
> to resolve it.

## Local sanity

```sh
node -e "require('./src/main.js')({ req:{method:'GET',path:'/',query:{name:'mike'}}, res:{json:console.log}, log:console.log }).then(()=>{})"
```

## What happens at deploy time

The Build worker (revenexx-platform/Builds.php) reads the three contract
files from the deployment archive and orchestrates two M2M calls in
order:

1. **Console** receives `manifest.json` + `billing.json` →
   `POST /api/v1/apps/{vendor}/{name}/versions` registers (or upgrades)
   the app version.
2. **Baseline** receives `manifest.json` + `schema.json` →
   `POST /api/v1/schemas/apply` materialises the declared tables on the
   apps Postgres cluster, applies RLS policies, creates the per-app role,
   grants column-level access, and the table becomes immediately
   queryable through PostgREST as `apps.revenexx__sample_app__greetings`
   (`greetings` here, but namespace-prefixed in the database).

Skipping `schema.json` is a first-class shape — Apps that don't need
managed DB tables (pure SPA frontends, function-only Apps) just leave it
out; the Build worker silently skips the Baseline call. See
[Baseline docs](https://baseline.revenexx.com) for the schema.json
grammar reference.

## Verifying the round-trip

After deploy, the Postgres apps cluster should show:

```sql
\dt apps.revenexx__sample_app__greetings
-- columns include id, name, message, locale, metadata, created_at,
-- updated_at, plus auto-injected tenant_id
```

A PostgREST request with a tenant-scoped JWT:

```sh
curl https://api.revenexx.com/revenexx__sample_app__greetings \
  -H "Authorization: Bearer $JWT_FOR_acme-eu"
# Returns rows where tenant_id = 'acme-eu' (RLS-filtered).
```
