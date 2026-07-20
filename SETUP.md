# Setup

Three phases. Phase 1 gets a working site on your laptop in a few
minutes. Phase 2 puts it online. Phase 3 adds the Ask feature, and is
entirely optional.

---

## Phase 1 — Run it locally

You need Python (for the build script only) and nothing else.

```bash
cd ketogenesis-site
python tools/build_menu.py
```

That reads `tools/catalogue.csv` and writes two files: `public/menu.json`
for the site and `worker/src/menu.js` for the Worker. Both are generated,
so never edit them by hand.

Now serve the `public` folder. The page fetches `menu.json`, so opening
`index.html` directly from the filesystem will not work in most browsers.

```bash
cd public
python -m http.server 8000
```

Open http://localhost:8000

Things to try: type "brownie", tap a category chip, add a few items, then
tap **Order on WhatsApp** and check the message is pre-filled correctly.

### Set your number

Open `public/config.js` and set `ORDER_NUMBER` to your uncle's WhatsApp
Business number: country code, no `+`, no spaces. For example
`923001234567`. Leave `ASK_URL` empty for now.

---

## Phase 2 — Put it online (free)

1. Push the project to a GitHub repository.
2. Go to **dash.cloudflare.com** → Workers & Pages → **Create** → Pages →
   **Connect to Git**, and pick the repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: `public`
4. Save and deploy.

You get a URL like `https://ketogenesis.pages.dev`. Every push to the
repo redeploys automatically, so updating the menu is: edit the CSV, run
the build script, commit, push.

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

Both connect to Cloudflare Pages the same way, and both give free HTTPS.

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

- *Bought from Cloudflare Registrar:* open your Pages project →
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
domain as active, open your Pages project → **Custom domains** → **Set
up a domain**. HTTPS is issued automatically.

Nameserver changes on `.pk` can take a few hours to propagate, so do
this when you are not in a rush.

---

#### Whichever route you take

Register the domain in **your uncle's name and email**, not yours. It is
his business asset, and you will be in Helsinki.

#### Update two things after the domain goes live

Easy to forget, and it will silently break the Ask box.

1. In `worker/wrangler.toml`, change `ALLOWED_ORIGIN` to the new domain
   (for example `https://ketogenesis.pk`), then redeploy the Worker.
   The old Pages URL will otherwise be the only origin accepted, and
   every request from the new domain gets a 403.
2. Re-check `public/_headers` if you ever move the Worker to a custom
   domain too, since the content security policy there allows
   `https://*.workers.dev` for `connect-src`.

Then update the link in his Instagram bio and WhatsApp Business profile.
The `pages.dev` URL keeps working alongside the custom domain, so
nothing breaks during the switch.

---

## Phase 3 — The Ask feature (optional)

This adds the free-text question box. Skip it if you want; the site is
complete without it.

You need a Cerebras API key from **cloud.cerebras.ai** (free, no card).

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put CEREBRAS_API_KEY
npx wrangler deploy
```

`wrangler deploy` prints a URL like
`https://ketogenesis-ask.your-name.workers.dev`.

Put that URL into `public/config.js` as `ASK_URL`, then commit and push.
The Ask button appears automatically.

### Lock down the Worker

Once the site is live, open `worker/wrangler.toml`, change
`ALLOWED_ORIGIN` from `"*"` to your exact Pages URL (no trailing slash),
and redeploy:

```toml
ALLOWED_ORIGIN = "https://ketogenesis.pages.dev"
```

The Worker checks this **server-side**, not just as a CORS header. CORS
headers are only advisory: browsers honour them, but curl, scripts and
bots ignore them completely. With `ALLOWED_ORIGIN` set, any request
whose `Origin` header does not match is refused with a 403.

One consequence: once locked down, `curl` tests stop working, because
curl sends no `Origin` header. Do your curl testing first, or pass
`-H "Origin: https://ketogenesis.pages.dev"`.

### Abuse protection

Origin checking stops casual misuse but not a determined attacker, who
can forge an `Origin` header. The exposure is limited: they could burn
your daily Cerebras allowance, which stops the Ask box working until it
resets. They cannot run up a bill, because every tier here is hard-capped
rather than metered, and they cannot reach your API key, which never
leaves the Worker.

If it ever becomes a problem, Cloudflare's dashboard has Rate Limiting
Rules on the free plan. Add one rule on the Worker route, something like
20 requests per minute per IP.

### Testing the Worker before wiring it in

```bash
curl -X POST https://ketogenesis-ask.your-name.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"q":"do you have anything sweet"}'
```

On Windows PowerShell use `curl.exe` and put the JSON in a file:

```
curl.exe -X POST https://ketogenesis-ask.your-name.workers.dev -H "Content-Type: application/json" -d "@test.json"
```

You should get back `{"answer": "...", "items": [...]}`.

If `answer` comes back `null` but `items` has results, the Worker is fine
and the Cerebras call failed. Check the key with
`npx wrangler secret list`, and check the model name in `wrangler.toml`
against inference-docs.cerebras.ai — Cerebras rotates its public models.

---

## Phase 4 — The real menu

Your uncle's WhatsApp Business catalogue lives in Meta **Commerce
Manager** (business.facebook.com/commerce). Open the catalogue → Items →
export to CSV. Rearrange the columns to match `tools/catalogue.csv`, fill
in macros where he has them, then rebuild and push.

The build script is forgiving with real exports: blank descriptions,
blank macros, commas and quotes inside fields, and Urdu text all work.
Rows missing a name or price are skipped and reported rather than
silently included.

Product photos: the export includes image URLs. Either paste those into
the `image` column, or download them into `public/img/` and reference
them as `img/filename.jpg`. Local copies are safer, since Meta's image
URLs expire.

---

## Tuning the search

Both `public/app.js` and `worker/src/index.js` contain an identical
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

## Cost summary

| Item | Cost |
|:-----|:-----|
| Cloudflare Pages hosting | Rs 0 |
| Cloudflare Worker (100k requests/day) | Rs 0 |
| Cerebras (1M tokens/day) | Rs 0 |
| GitHub | Rs 0 |
| Custom domain | optional, ~Rs 3,000–4,000/year |

Never add a payment method to Cerebras. Without one, the free tier is a
hard cap that simply stops working when exhausted. With one, it becomes
a bill.
