# Deploying the website

The site is static (`pnpm --filter @whittlebrowser/website build` writes `website/dist`) plus one Cloudflare Pages Function,
`functions/api/waitlist.js`, which saves waitlist signups to a Cloudflare D1 database.

## One-time setup

The Pages project is connected to this GitHub repository, so every push to `main` builds and deploys the site. A project made with
dashboard drag-and-drop or `wrangler pages deploy` cannot be switched to Git later, and drag-and-drop does not support Functions
(the waitlist is one), so use the Git connection.

1. **Create the table.** The database `whittlebrowser-waitlist` already exists (its id is in `wrangler.toml`). Add the table once, either in
   the dashboard (Storage & Databases → D1 → the database → Console, paste the contents of `schema.sql`) or from a terminal:
   ```bash
   npx wrangler login      # first time only
   npx wrangler d1 execute whittlebrowser-waitlist --remote --file=website/schema.sql
   ```
   `--remote` matters: without it the table is created in a local test copy instead of the real database.
2. **Create the project.** Workers & Pages → Create → Pages → Import an existing Git repository → this repo. Name it `whittlebrowser`
   (it must match `name` in `wrangler.toml`). Settings:
   - Production branch: `main`
   - Framework preset: None
   - Root directory (advanced): `website`
   - Build command: `pnpm install --frozen-lockfile && pnpm build`
   - Build output directory: `dist`
   - Optional: environment variable `PNPM_VERSION` = `10.13.1` to match the repo (the default pnpm 10 also works).
3. **Check the database link.** `wrangler.toml` binds the database as `DB`, and Cloudflare treats that file as the source of truth for a
   Pages project that uses it. After the first deploy, open it: the Functions tab should list `/api/waitlist` and Settings → Bindings
   should show `DB`. If `DB` is missing, add it there (D1 database, variable name `DB`) and redeploy.
4. **Attach the domain.** Project → Custom domains → Set up a domain → `whittlebrowser.app` → confirm the DNS record. When the domain is
   in the same Cloudflare account, the record is added for you.
5. **Test it live.** Join the waitlist on `/cloud` with a real address, read it back (below), and try an `@mailinator.com` address to
   confirm it is refused.

## Reading the waitlist

```bash
npx wrangler d1 execute whittlebrowser-waitlist --remote --command "SELECT email, interest, created_at FROM waitlist ORDER BY created_at"
```

Only the email, which list it is for (`cloud`), and the time are stored. In the dashboard, run the same `SELECT` in the D1 Console. No IP address, no user agent.

## Cost

Free for a waitlist. On Cloudflare's free plan (checked October 2026): Pages Functions share 100,000 requests a day with Workers,
and D1 allows 5 million rows read and 100,000 rows written a day, with 5 GB of storage. Static pages and assets are free and
unlimited. A signup is one function request and one row written, so these limits allow about 100,000 signups a day. When a limit is
hit the form returns an error until midnight UTC. Going over means the Workers Paid plan, a $5 a month minimum, with D1 and
Functions overage billed per million. See Cloudflare's pricing pages for current numbers.

## Abuse protection

The endpoint refuses cross-site posts, caps the body at 2 KB, validates the address, rejects temporary and disposable email
addresses, and has a honeypot field. Add a Cloudflare
rate-limiting rule for `POST /api/waitlist` (Security → WAF) before announcing the page; add Turnstile if bots get through.

## Local development

`pnpm --filter @whittlebrowser/website dev` serves the site on http://localhost:4321 and saves signups to
`website/.data/waitlist.jsonl` (git-ignored) instead of D1.

## Disposable email block

`lib/disposable-domains.mjs` holds about 9,900 temporary-email domains from the community list
[disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) (CC0, public domain). A listed domain also
blocks its subdomains. New disposable services appear all the time, so refresh the list now and then:

```bash
pnpm --filter @whittlebrowser/website update:disposable   # downloads, sanity-checks, rewrites the file
pnpm --filter @whittlebrowser/website test
```

The script refuses to write a list that is tiny or that contains a mainstream provider such as gmail.com, so a bad download cannot
block everyone. A static list can't catch a brand-new service; the rate-limit rule above is the second line of defence.
