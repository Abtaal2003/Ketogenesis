# Setup

Three phases. Phase 1 gets a working site on your laptop in a few
minutes. Phase 2 puts it online. Phase 3 adds the Ask feature, and is
entirely optional.

---

## Phase 1 — Run it locally

You need Node (which you already have for Wrangler) and nothing else —
no Python.

```bash
npm install
npm run menu
```

That reads `tools/catalogue.xlsx` and writes two files: `public/menu.json`
for the site and `src/menu.js` for the Worker. Both are generated, so
never edit them by hand.

Now serve the site with Wrangler, which runs both the static files and
the `/ask` endpoint together, exactly as in production:

```bash
npm run dev
```

Open the URL Wrangler prints (usually http://localhost:8787). Opening
`index.html` directly from the filesystem will not work, because the page
fetches `menu.json` over HTTP.

Things to try: type "brownie", tap a category chip, add a few items, then
tap **Order on WhatsApp** and check the message is pre-filled correctly.

### Set your number

Open `public/config.js` and set `ORDER_NUMBER` to your uncle's WhatsApp
Business number: country code, no `+`, no spaces. For example
`923001234567`. Leave `ASK_URL` empty for now.

---

## Phase 2 — Put it online (free)

This project is a single Cloudflare **Worker** with static assets
(`main = "src/index.js"` plus an `[assets]` directory in `wrangler.toml`),
not a classic Pages project — so it's connected under **Workers**, not
**Pages**.

1. Push the project to a GitHub repository.
2. Go to **dash.cloudflare.com** → Workers & Pages → **Create** →
   **Workers** → **Connect to Git**, and pick the repo. Cloudflare reads
   `wrangler.toml` directly, so there's no separate build-output-directory
   field to fill in — the `[build]` command and `[assets]` directory in
   the file are already all it needs.
3. Save and deploy.

You get a URL like `https://ketogenesis.<your-subdomain>.workers.dev`.
Every push to the repo redeploys automatically, so updating the menu is:
replace `tools/catalogue.xlsx`, commit, push — Cloudflare runs the build
script itself (see "Updating the menu" in the README).

### Where to link it

- WhatsApp Business profile has a website field
- Instagram bio link
- The greeting message in WhatsApp Business, so anyone who messages gets
  the link automatically

### A custom domain (optional, the only thing that costs money)

Everything else here is free. A domain is not, but it is cheap and it is
what makes the site look like a real business rather than a project.

There are two routes, and they work quite differently. Pick one.

- **Route A — an international domain** (`.com`, `.co`, `.shop`). Bought
  online in five minutes with a card. No paperwork.
- **Route B — a Pakistani domain** (`.pk`, `.com.pk`). Cheaper, more
  local credibility, but registered through PKNIC and requires a CNIC.

Both connect to the Worker the same way, and both give free HTTPS.

---

#### Route A — a `.com` or other international domain

**1. Check availability.** `ketogenesis.com` may well be taken. Search
before settling on a name.

| Extension | Rough cost/year | Notes |
|:---|:---|:---|
| `.com` | Rs 3,000–4,500 | Most familiar, most likely taken |
| `.co` | Rs 7,000–9,000 | Common `.com` fallback |
| `.shop`, `.store`, `.food` | Rs 1,500–5,000 | Cheap year one, often dearer on renewal |

Always check the **renewal** price, not the first-year price. Some
registrars discount year one heavily and renew at several times that.

From the search you already ran, `ketogenesis.com` is taken but these
were available: `keto-genesis.com` (Rs 1 first year on a 3-year term,
then full price), `ketogenesis.store` and `ketogenesis.shop` (Rs 278
first year). Treat the Rs 1 and Rs 278 offers with suspicion and look up
what year two costs before committing — that is exactly the pattern this
section warns about. `ketogenesis.shop` reads well for a food producer.

**2. Buy it.** **Cloudflare Registrar is the best choice here.** It
sells at cost with no markup and no upsells, and because the site is
already on Cloudflare the DNS wiring is then automatic. Dashboard →
**Domain Registration → Register Domain**.

If Cloudflare does not carry the extension you want, Namecheap and
Porkbun are both reasonable and honest about renewal pricing.

**3. Connect it.**

- *Bought from Cloudflare Registrar:* open your Worker project →
  **Custom domains** → **Set up a domain** → type the domain → confirm.
  Cloudflare adds the DNS records itself. Live in a couple of minutes.
- *Bought elsewhere:* add the domain to Cloudflare first
  (**Add a site**, free plan), change the nameservers at your registrar
  to the two Cloudflare provides, wait for it to show as active
  (minutes to 24 hours), then follow the same **Custom domains** steps.

---

#### Route B — a `.pk` or `.com.pk` domain

PKNIC (Pakistan Network Information Centre, operated under PTCL) is the
official registry for the whole `.pk` namespace. It sets a wholesale
rate that every registrar pays, so the differences you see between
sellers are pure markup.

**1. Choose the extension.** `.pk` is shorter; `.com.pk` reads as more
obviously commercial. Both are fine locally. Search PKNIC's WHOIS tool
at pknic.net.pk to check availability.

**2. Know the two rules that surprise people.**

- **Minimum two years.** PKNIC does not sell single-year registrations.
  You buy in even-numbered year blocks.
- **Renew on time.** There is roughly a 15-day grace period after
  expiry. Miss it and the domain can enter a probation period or go to
  auction, and you cannot simply renew your way out of it. Put the
  renewal date in a calendar the day you buy it.

**3. Documents — and the good news here.**

- **Registering as an individual** needs only a valid Pakistani CNIC.
  Expired cards are rejected outright.
- **Registering as a business** needs a Certificate of Incorporation
  from SECP and related paperwork.

If Ketogenesis does not have SECP incorporation — the same paperwork gap
that blocked the WhatsApp API route — **register it as an individual
using your uncle's CNIC**. The domain still says Ketogenesis. This path
has no business-verification requirement at all.

**4. Buy it.** PKNIC itself is not consumer-facing; you go through an
accredited reseller. HostBreak, HosterPK, Truehost.pk and PK-Domain are
all long-established. Expect somewhere around Rs 2,200–3,400 for two
years depending on the reseller's markup.

Compare the **renewal** column across two or three resellers before
buying. That is where the price differences actually bite, and some
sellers renew at double what they charged you initially.

Payment is usually available by local bank transfer or card, which is
often easier than an international registrar.

**5. Connect it.** Add the domain to Cloudflare (**Add a site**, free
plan), then log into your reseller's control panel and change the
nameservers to the two Cloudflare gives you. Once Cloudflare shows the
domain as active, open your Worker project → **Custom domains** → **Set
up a domain**. HTTPS is issued automatically.

Nameserver changes on `.pk` can take a few hours to propagate, so do
this when you are not in a rush.

---

#### Whichever route you take

Register the domain in **your uncle's name and email**, not yours. It is
his business asset, and you will be in Helsinki.

#### Nothing to update for the Ask box

Older versions of this project had an `ALLOWED_ORIGIN` setting that had
to be updated by hand whenever the domain changed. That's gone: the
Worker now checks same-origin dynamically (`sameOrigin()` in
`src/index.js`), comparing each request's `Origin` header against
whatever host it actually arrived on. A custom domain works automatically,
with nothing to edit and nothing to redeploy.

Just update the link in his Instagram bio and WhatsApp Business profile.
The `workers.dev` URL keeps working alongside the custom domain, so
nothing breaks during the switch.

---

## Phase 3 — The Ask feature (optional)

This adds the free-text question box. Skip it if you want; the site is
complete without it.

There is only one Worker (the same one from Phase 2), so there is
nothing separate to deploy and no URL to copy anywhere: `ASK_URL` in
`public/config.js` is already set to `/ask`, a path on this same origin,
and stays that way.

Pick a provider and get a free API key, no card required:

- **Gemini** — a key from **aistudio.google.com**. This is what
  `wrangler.toml` is currently set to (`LLM_PROVIDER = "gemini"`).
- **Cerebras** — a key from **cloud.cerebras.ai**, if you'd rather use
  that instead. Switch to it by changing `LLM_PROVIDER` to `"cerebras"`
  in `wrangler.toml`.

Then, from the repo root:

```bash
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
# or: npx wrangler secret put CEREBRAS_API_KEY, if using Cerebras
npx wrangler deploy
```

Commit and push if you changed `LLM_PROVIDER`. The Ask button appears
automatically once a key is set for whichever provider is selected —
no other wiring needed.

### Locking down the endpoint

There's no setting to change for this: `/ask` already only accepts
requests whose `Origin` header matches the host it was sent to
(`sameOrigin()` in `src/index.js`), checked server-side rather than as
an advisory CORS header. It works the same on the `workers.dev` URL and
on a custom domain, automatically, with nothing to keep in sync.

### Abuse protection

Origin checking stops casual misuse but not a determined attacker, who
can forge an `Origin` header. The exposure is limited: they could burn
your daily free-tier allowance, which stops the Ask box working until it
resets. They cannot run up a bill, because every tier here is hard-capped
rather than metered, and they cannot reach your API key, which never
leaves the Worker.

If it ever becomes a problem, Cloudflare's dashboard has Rate Limiting
Rules on the free plan. Add one rule on the Worker route, something like
20 requests per minute per IP.

### Testing the Worker before wiring it in

Same-origin checking means curl needs an explicit `Origin` header —
there is no unlocked state where it isn't required:

```bash
curl -X POST https://ketogenesis.your-subdomain.workers.dev/ask \
  -H "Content-Type: application/json" \
  -H "Origin: https://ketogenesis.your-subdomain.workers.dev" \
  -d '{"q":"do you have anything sweet"}'
```

On Windows PowerShell use `curl.exe` and put the JSON in a file:

```
curl.exe -X POST https://ketogenesis.your-subdomain.workers.dev/ask -H "Content-Type: application/json" -H "Origin: https://ketogenesis.your-subdomain.workers.dev" -d "@test.json"
```

You should get back `{"answer": "...", "items": [...]}`.

If `answer` comes back `null` but `items` has results, the Worker is fine
and the provider call failed (or its key was never set — check the
Cloudflare dashboard logs, which now note this specifically). Check the
key with `npx wrangler secret list`, and check the model name in
`wrangler.toml` against the provider's docs — both Gemini and Cerebras
rename their models across generations.

---

## Phase 4 — The real menu

The menu is just a spreadsheet: `tools/catalogue.xlsx`. To update it,
replace that one file and push. Cloudflare rebuilds `menu.json` and
`src/menu.js` from it on deploy — there is no CSV or Python step.

**The update flow, start to finish:**

1. Your uncle exports his catalogue from WhatsApp Business (or Commerce
   Manager at business.facebook.com/commerce) as an `.xlsx`.
2. Rename it `catalogue.xlsx`, replace `tools/catalogue.xlsx` in the repo
   (on GitHub: *Add file → Upload files*, drop it in, commit).
3. That's it — the push triggers a rebuild and the live site updates.

The build script is forgiving with real exports. Column headers are
matched loosely (`Collection`/`Category`, `Item Name`/`Name`,
`Price (PKR)`/`Price`, `Description`). Only an item column and a price
column are strictly required. Blank descriptions, Urdu text, commas and
quotes inside cells, and non-breaking hyphens all work. Rows missing a
name or price are skipped and reported rather than silently included.

Macros can be written straight into the description text — e.g.
"...; macros per square: Fat 19.5g, Protein 3.1g, Carbs 2.3g, Energy
198kcal" — and the script lifts them into a clean macro strip while
keeping the description searchable. An internal "Hidden item;" prefix
from the WhatsApp export is stripped so customers never see it. If a
future sheet has dedicated `carbs` / `fat` / `protein` / `kcal` /
`serving` columns instead, those are used directly.

Product photos: add an `image` column with either a URL or a filename
like `img/keto-brownies.jpg`, downloaded into `public/img/`. Local
copies are safer, since exported image URLs expire.

---

## Tuning the search

Both `public/app.js` and `src/index.js` (repo root, no `worker/` folder)
contain an identical
`STOPWORDS` set: 246 common words that carry no meaning in a menu
search. Without it, "anything **with** almond flour" scores every item
whose description happens to contain "with".

The list is NLTK's standard English stopwords, plus a shopping layer
(price, available, order, please) and a Roman Urdu layer (hai, kya,
kitna, chahiye), since customers here type both.

**Food words are deliberately never filtered** — free, low, keto, sugar,
gluten, cheeni, meetha, namkeen, roti and every ingredient name stay
searchable.

Two rules if you edit it:

1. **Change both files identically.** If they drift, typing a query and
   pressing Ask on the same query start returning different items, which
   reads as a bug to a customer.
2. **Never add a word that could describe food.** Filtering "free" would
   break every search for sugar-free and gluten-free items.

### The remaining gap: Urdu product words

Search matches characters, not meaning. "mujhe kuch namkeen chahiye"
finds nothing, because no English description contains "namkeen". The
stopwords strip the filler correctly; the problem is the product word
itself.

The fix is an alias map applied before scoring, once you know which words
your customers actually use:

```js
const ALIASES = { meetha: "sweet dessert", namkeen: "savoury snack",
                  cheeni: "sugar", roti: "bread" };
```

Wait until the real menu is live and watch what people type. Guessing the
vocabulary now would be solving an imaginary problem.

---

## Troubleshooting

Written for whoever is running the site day to day, not necessarily the
person who built it. Everything here is diagnosable from the Cloudflare
dashboard and a browser — nothing needs a local checkout.

The one thing worth knowing up front: **the site is built to fail
quietly.** If the AI part breaks, the menu keeps working and customers
still see matching products. That is deliberate, but it means a broken
Ask box looks a lot like a working one. Check it every so often rather
than waiting to be told.

### The menu didn't change after I uploaded a new spreadsheet

The build runs on Cloudflare, not on your computer, so the file being on
GitHub is not the same as the file being live.

1. Open the repository on GitHub and confirm `tools/catalogue.xlsx`
   really shows today's date under "Last commit".
2. Go to **dash.cloudflare.com → Workers & Pages → ketogenesis →
   Deployments**. There should be a deployment from a minute or two after
   your upload. If it is red, open it and read the build log.
3. The log ends with a line like `77 items across 11 categories`. If the
   number is lower than you expect, rows were skipped — the log names
   how many and why. A row is skipped when it has no item name or no
   price.

Hard-refresh the page before concluding it didn't work (Ctrl+Shift+R, or
Cmd+Shift+R on a Mac). Browsers cache aggressively.

### The page loads but the menu area is empty

The site could not load `menu.json`. Almost always a failed build that
left the file missing or malformed. Check the Deployments log as above.
Re-deploying the last good version from the dashboard restores the site
immediately while you sort out the spreadsheet.

### The Ask box shows products but never writes an answer

This is the failure the site hides on purpose, so it is worth
recognising: you type a question, you get matching items underneath, but
the sentence at the top always reads "Here are the closest matches from
our menu."

That means the AI call is not succeeding. Three causes, in order of
likelihood:

1. **The API key is missing or wrong.** Go to **ketogenesis → Settings →
   Variables and Secrets** and confirm a secret exists whose name matches
   the provider in use. `wrangler.toml` sets `LLM_PROVIDER`; if it says
   `"gemini"` the secret must be `GEMINI_API_KEY`, if `"cerebras"` then
   `CEREBRAS_API_KEY`. Having the *other* one set does not help.
2. **The model ID has been renamed.** Google and Cerebras both retire
   model names. Open Google AI Studio, look at which models the account
   can actually call, and compare against `GEMINI_MODEL` in
   `wrangler.toml`. Correct that one line, commit, done.
3. **The free quota is exhausted for the day.** It resets; try again
   tomorrow before changing anything.

To see which of the three it is, open **ketogenesis → Logs** in the
Cloudflare dashboard and ask the site a question with the log open. The
Worker prints the reason: a missing key, an empty answer with the
provider's own explanation, or the failed HTTP call.

### Dark mode doesn't remember my choice

`public/theme-init.js` is not loading. Open the page, press F12, and look
at the Console tab for a red message mentioning Content Security Policy.
If one is there, the script and the policy in `public/_headers` have
drifted apart — the policy allows same-origin script files only, so
`theme-init.js` must stay its own file and must not be pasted back into
`index.html`.

### None of the above

Take a screenshot of the Deployments log or the browser console and send
it to Abtaal. Nothing here is urgent enough to warrant guessing: the
menu, the search and the WhatsApp ordering all keep working even when the
AI layer is completely down, so the shop is never actually shut.

---

## Cost summary

| Item | Cost |
|:-----|:-----|
| Cloudflare Worker + static assets (100k requests/day) | Rs 0 |
| Gemini free tier (no card, no expiry) | Rs 0 |
| Cerebras (1M tokens/day), if you switch back | Rs 0 |
| GitHub | Rs 0 |
| Custom domain | optional, ~Rs 3,000–4,000/year |

**The two providers fail in opposite directions, so the rule differs.**

*Cerebras:* never add a payment method. Without one the free tier is a
hard cap that simply stops working when exhausted. With one it becomes a
bill.

*Gemini (what the site currently uses):* never enable billing on the
Google Cloud project the API key belongs to. This one is counterintuitive
— enabling billing does not give you a free tier followed by charges, it
**removes** the free tier from that project and bills from the very first
token. If you ever do want a paid Gemini setup, create a separate project
for it and leave this one billing-free.
