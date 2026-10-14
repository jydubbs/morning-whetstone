# Morning Whetstone

A ten-minute thinking question every morning, on the website and by email.

- **Website**: pick a theme, randomise, or do **Today's** question. Everyone gets the same question of the day.
- **Email**: visitors enter their email, confirm it, and get the question of the day at **7am UK time** (all year, GMT and BST). The email has the question only; the timer, hints and answer are on the site.
- **Unsubscribe**: a link in every email, plus the one-click "Unsubscribe" button in Gmail and Apple Mail.

Everything runs on Cloudflare's free plan. Emails are sent with Resend.

## What's in the folder

| Path | What it is |
|---|---|
| `public/index.html` | The website |
| `public/questions.js` | All 287 questions, and the question-of-the-day picker |
| `src/worker.js` | Sign-up, confirm, unsubscribe and the daily send |
| `schema.sql` | The subscriber table |
| `wrangler.toml` | Settings: your site address, sender email, send times |

## Set it up (about 30 minutes, one time)

You'll need: a computer with [Node.js](https://nodejs.org) installed, a free Cloudflare account, a free Resend account, and a domain name to send email from (around £10 a year; you can buy one through Cloudflare).

**1. Install**
Open a terminal in this folder and run:
```
npm install
npx wrangler login
```

**2. Create the subscriber database**
```
npx wrangler d1 create whetstone
```
Copy the `database_id` it prints into `wrangler.toml`. Then create the table:
```
npm run db:init
```

**3. Set up email sending (Resend)**
1. Sign up at resend.com.
2. Domains → Add domain → follow the steps to add the DNS records (if your domain is on Cloudflare, Resend can add them for you).
3. API Keys → Create API key. Then run this and paste the key when asked:
```
npx wrangler secret put RESEND_API_KEY
```
4. In `wrangler.toml`, set `FROM_EMAIL` to an address on that domain, e.g. `Morning Whetstone <question@yourdomain.com>`.

**4. Deploy**
```
npm run deploy
```
It prints your live address, like `https://morning-whetstone.yourname.workers.dev`. Put that in `SITE_URL` in `wrangler.toml` and run `npm run deploy` again.

**5. Test it**
Subscribe with your own email, click the confirm link, and the next 7am email will arrive. To see what's on the list:
```
npx wrangler d1 execute whetstone --remote --command "select email, confirmed, last_sent from subscribers"
```

**Optional: your own domain for the site.** In Cloudflare, open the worker → Settings → Domains & Routes → add e.g. `whetstone.yourdomain.com`, then update `SITE_URL`.

## Running it on your computer

```
npm run db:init:local
npm run dev
```
Open http://localhost:8787. Emails won't send locally unless `RESEND_API_KEY` is set in a `.dev.vars` file.

## Editing questions

Edit `public/questions.js`. Each question looks like:
```js
{q:"The question", h:["Hint 1","Hint 2","Hint 3"], a:"The answer"},
```
Then `npm run deploy`. Note: adding questions changes the order of future questions of the day.

## Limits and costs

- **Cloudflare free plan**: plenty for this (100,000 requests a day).
- **Resend free plan**: 3,000 emails a month and 100 a day, so about **100 subscribers**. Beyond that, the Pro plan is around $20 a month for 50,000 emails.

## Before you share it publicly

The UK GDPR and PECR apply to email lists. This setup already does the main things: people confirm their email before getting anything, and every email has an unsubscribe link. You should also add a short privacy note to the site saying what you store (just the email address), why, and who processes it (Cloudflare and Resend), plus a contact address.
