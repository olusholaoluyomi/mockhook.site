# Mockhook

Your own webhook.site, plus a mock API builder. Anyone can create an account with a username and password and gets their own private set of endpoints. Every endpoint:

- **Records** every request sent to it (method, path, query, headers, body, IP) and shows it live in the dashboard.
- **Replies** with fake data you design in a field builder, or a fixed body you write.
- **Paginates** the fake data (`?page=2&limit=10` or `?offset=20&limit=10`), with meta, next/prev links, or paging headers. Callers that page with POST can send `page`, `offset` and `limit` in a JSON or form body instead.
- Lets you set the **status code, headers and a delay**, so you can test slow or failing APIs.

## Deploy to Vercel (free)

1. **Put the code on GitHub.** Create a new repository and upload this folder (everything except `node_modules`).
2. **Import it on Vercel.** On vercel.com, click *Add New → Project*, pick the repository. Leave Framework Preset as **Other** and the build settings empty. Click **Deploy**.
3. **Add Upstash storage.** In the project, open the **Storage** tab, choose **Upstash for Redis** from the Marketplace, create a free database and connect it to this project. Vercel adds the connection settings for you.
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the storage settings take effect.

Open your Vercel URL, create an account, and click **＋ Create**. If you see a red banner saying Upstash isn't connected, step 3 or 4 didn't take.

Prefer the command line? Run `npx vercel` in this folder instead of steps 1–2.

## Accounts

- Visitors pick a username and password on the site. There is no email and **no password reset**, so a forgotten password means a new account.
- Each person sees only their own endpoints and captured requests. Nobody else can open, change or delete them.
- Endpoint URLs (`/h/<id>`) stay open to any caller, since that's their job. IDs are shared across the whole site, so a custom ID someone else already uses is refused.
- Sign-in is slowed after 10 wrong tries in 15 minutes, and one network can create 5 accounts an hour.

Optional settings (*Settings → Environment Variables* on Vercel, then redeploy):

| Variable | What it does |
| --- | --- |
| `ALLOW_SIGNUPS` | Set to `false` to stop new accounts. Existing ones keep working. |
| `MAX_ENDPOINTS_PER_USER` | Endpoints one account may hold. Default 25. |
| `HISTORY_LIMIT` | Requests kept per endpoint. Default 100. |

**Coming from the single-password version?** Your old endpoints keep answering. Create an account, and a blue banner offers to move them into it once you enter the old `DASHBOARD_PASSWORD`. After that you can delete that variable.

**A note on shared sites.** Endpoint replies are written by their owners and served from the same address as the dashboard. Every reply carries `Content-Security-Policy: sandbox`, so if one is opened in a browser as a page, its scripts can't reach another person's sign-in. Programs calling an endpoint as an API are not affected. An HTML mock will display, but its scripts and forms won't run.

## Using it

Each endpoint lives at `https://your-app.vercel.app/h/<id>`. Any method and any sub-path works: `/h/users`, `/h/users/123`, `/h/users/webhooks/paystack?x=1` all hit the same endpoint, and the path is shown on each captured request.

**Tabs in the dashboard**

| Tab | What it does |
| --- | --- |
| Requests | Captured requests, updated when you tap Refresh (or tick Auto). Tap one for body, query and headers, or copy it as cURL. Only what the caller sent is shown. |
| Response data | Pick generated data or a fixed body. Build the fields of each item, choose the data region (e.g. English, Nigeria), and wrap the reply in keys like `status` and `message`. |
| Pagination | Total items, page sizes, page or offset style, parameter names, envelope or plain array. |
| Settings | Status code (200–599), custom headers, delay, and whether requests are recorded. A header that can't be sent is flagged and left out. |
| Test | Preview unsaved settings, or send a real request that shows up under Requests. The path box accepts a query too, e.g. `/orders?page=2`. |

Saved changes go live within about 10 seconds (configs are cached briefly to save Upstash usage). A new endpoint works straight away, and its ID is not case-sensitive in the URL.

Bodies that aren't text (files, images) are kept as their original bytes, up to 48 KB, and can be downloaded from the request's Body tab.

**Field types worth knowing**

- **Sequential ID** continues across pages, so page 2 starts where page 1 ended.
- **Same data on every call** keeps item #7 identical on every request and every page size. Turn it off for fresh random values each time. *Reshuffle* gives you a new consistent set.
- **Value from the request** echoes what the caller sent: `query.userId`, `body.user.email`, `headers.x-api-key`, `method`, `path`. Set a fallback for when it's missing.
- **Object** groups fields; **List of items** makes an array with a random length between min and max. A list with a single field and an empty name gives plain values, like `["red", "blue"]`.
- **Pattern** makes codes: `#` digit, `?` letter, `*` either. `TXN-####-??` → `TXN-4821-QK`.
- **One of** picks from a list you give: `pending, paid, failed`. Values like `true` or `200` come out as real JSON types.
- **Sometimes null (%)** on any field makes it null some of the time.

## Free tier usage

- Recording one request uses 3 Upstash commands. Upstash's free tier gives 500K commands a month, so about 150K+ recorded requests.
- Turning off *Record incoming requests* on mock-only endpoints makes them cost about 0 commands (just a config read every 10s or so).
- The dashboard checks for new requests once when you open an endpoint, then only when you tap **Refresh** (1 command per check, sometimes 2). Tick **Auto** to check every 5 seconds while the tab is visible instead.
- Signing in or creating an account costs about 5 to 8 commands.
- The last 100 requests per endpoint are kept. Change with the `HISTORY_LIMIT` environment variable.
- The site is open to anyone who finds it, and all accounts share your Upstash allowance. If usage climbs, set `ALLOW_SIGNUPS=false` or lower `MAX_ENDPOINTS_PER_USER`.

## Run it on your computer

```
npm install
npm run dev
```

Open http://localhost:3000. Without Upstash settings it uses memory, which resets when you stop it. To use your Upstash database locally, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`) before running.

## Project layout

```
api/hook.js        the endpoint itself: records requests and replies
api/auth.js        create account, sign in, sign out, import old endpoints
api/endpoints.js   create, list, update, delete your endpoints
api/requests.js    captured requests for the dashboard
api/preview.js     runs unsaved settings without recording
api/meta.js        field types, regions, setup status, who is signed in
lib/auth.js        password hashing, sessions, attempt limits
lib/generate.js    fake data, pagination, wrapping
lib/catalog.js     the list of field types
lib/redis.js       Upstash connection (memory fallback for local dev)
public/index.html  the dashboard
vercel.json        routes /h/* to the endpoint function
```
