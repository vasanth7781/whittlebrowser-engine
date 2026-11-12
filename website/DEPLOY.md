# Deploying the website

The site is static (`pnpm --filter @whittlebrowser/website build` writes `website/dist`) plus one Cloudflare Pages Function,
`functions/api/waitlist.js`, which saves waitlist signups to a Cloudflare D1 database.

## One-time setup

The site code must be merged to `main` first, because Cloudflare builds from the repository.

1. Create the database and its table (once; sign in with `npx wrangler login` the first time):
   ```bash
   npx wrangler d1 create whittlebrowser-waitlist
   npx wrangler d1 execute whittlebrowser-waitlist --remote --file=website/schema.sql
   ```
   `--remote` matters: without it the table is created in a local test database instead of the real one.
2. Workers & Pages → Create → Pages → connect the GitHub repository, then set:
   - Root directory: `website`
   - Build command: `pnpm install --frozen-lockfile && pnpm build`
   - Build output directory: `dist`
   Cloudflare's build image defaults (Node 22, pnpm 10) are fine. To match the repo's pnpm exactly, add the environment variable `PNPM_VERSION=10.13.1`.
3. Project → Settings → Bindings → Add → D1 database bindings. Variable name `DB`, database `whittlebrowser-waitlist`.
   **Redeploy afterwards** (Deployments → the latest one → Retry deployment), or the binding does not take effect.
4. Project → Custom domains → Set up a domain → `whittlebrowser.app` → Continue → confirm the DNS record. When the domain is in the same
   Cloudflare account the record is added for you.

## Reading the waitlist

```bash
npx wrangler d1 execute whittlebrowser-waitlist --remote --command "SELECT email, interest, created_at FROM waitlist ORDER BY created_at"
```

Only the email, which list it is for (`cloud`), and the time are stored. No IP address, no user agent.

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
