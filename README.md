# sample-app

Reference scaffold for a revenexx App. A minimal hello-world function used to
smoke-test the App Registry runtime end-to-end (manifest validation → build →
register → deploy → execute).

## Layout

| Path             | Purpose                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| `manifest.json`  | App contract — identity, permissions, events, policies. Validated against revenexx-console at deploy time. |
| `billing.json`   | Marketplace pricing/distribution. `type: free` → no Chargebee plan needed.            |
| `src/main.js`    | The function entrypoint. Appwrite-style `module.exports = async (context) => …`.      |
| `package.json`   | Node package manifest. Pinned to Node 22+.                                            |

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
# to src/main.js, commands to npm install if you add deps).
curl -X POST https://app.revenexx.com/v1/apps/:appId/deployments \
  -H "X-Revenexx-Project: revenexx" \
  -H "X-Revenexx-Key: $REVENEXX_KEY" \
  -F "code=@sample-app.tar.gz" \
  -F "entrypoint=src/main.js" \
  -F "activate=true"
```

## Local sanity

```sh
node -e "require('./src/main.js')({ req:{method:'GET',path:'/',query:{name:'mike'}}, res:{json:console.log}, log:console.log }).then(()=>{})"
```
