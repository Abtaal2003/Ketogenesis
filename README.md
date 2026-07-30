# Keto Genesis — menu site

A fast, free menu website for Keto Genesis, "The Fat Burning Fuel
Factory" — a keto food producer in Bahria Town Phase 7, Rawalpindi,
trading since 2020. Customers browse the menu, search it, check macros, build an
order, and hand off to WhatsApp with the order already typed out.

Setup instructions: **[SETUP.md](SETUP.md)**

## How it works

One Cloudflare Worker serves everything. Files in `public/` are served
directly by Cloudflare; only `/ask` reaches the code.

```
Browser
  |
  |-- menu.json ships with the page
  |     browsing, category filter, search  ->  all local, instant, no network
  |
  |-- "Order on WhatsApp"
  |     builds a wa.me link with the order pre-filled  ->  opens WhatsApp
  |
  '-- "Ask" (optional)
        POST /ask -> same Worker -> retrieves the matching items
                                 -> the LLM answers from the top 5 only
```

Because the page and `/ask` share an origin there is no CORS, no
preflight, and no allowed-origin setting to keep in sync when the domain
changes. The Worker simply checks that a request's `Origin` matches the
host it was sent to.

The site works completely without the Worker. If `ASK_URL` is empty in
`config.js`, the Ask button hides and everything else behaves normally.
If the Worker is configured but fails, the site shows the matched items
instead of an answer. Nothing about the menu depends on a server staying up.

## Browsing

All of this happens in the page itself, with no network calls.

**Sorting.** A control beside the item count offers price low-to-high,
price high-to-low, or the default. The default is two different orders
depending on context, so it relabels itself: *Menu order* while browsing,
which is the order the spreadsheet is written in, and *Best match* while
a search is filtering, which is score order. Sorting by price replaces
whichever of those applied.

**Cross-listed products.** A few items are filed under two categories at
once — the pizza sits in both Savoury Stuff and Italian Cuisine — which
is correct, and each category page lists it. The **All** view collapses
them so the same product is never shown twice, which is why the card
count (73) is lower than the row count in the spreadsheet (77). The cart
matches on product name too, so adding the pizza from either category
gives one line, not two.

The two copies usually carry different descriptions, one written for each
section. The longer one goes on the card; the other stays in the search
index, so a word that appears only on the copy you cannot see still finds
the product. None of this is hardcoded to particular items — it keys on
the product name, so cross-listing something new works with no code
change.

## Layout

| Path | Purpose |
|:-----|:--------|
| `public/index.html` | Page structure |
| `public/styles.css` | All styling |
| `public/app.js` | Search, cart, WhatsApp handoff, Ask |
| `public/config.js` | The two settings you edit: WhatsApp number, Worker URL |
| `public/menu.json` | Generated menu data. Do not edit by hand |
| `public/img/` | Product photos, named after the product. Also holds the logo and `placeholder.webp`, the stand-in shown when a product has no photo |
| `tools/catalogue.xlsx` | The menu you maintain — the Excel file you export from WhatsApp Business |
| `tools/build_menu.mjs` | Reads the `.xlsx`, matches photos in `public/img/`, and writes both generated menus |
| `src/index.js` | The Worker: routes `/ask`, retrieval + the LLM call |
| `src/menu.js` | Generated menu module for the Worker. Do not edit by hand |
| `wrangler.toml` | Worker config: entry point, assets directory, vars |
| `public/_headers` | Security headers applied to every **static** response. Not applied to `/ask` — the Worker sets its own |

## Updating the menu

The menu comes from one file: `tools/catalogue.xlsx`. To update the
site, **replace that file and push** — nothing else:

1. Export the latest catalogue from WhatsApp Business as an `.xlsx`.
2. Rename it to `catalogue.xlsx` and replace `tools/catalogue.xlsx` in
   the repo (drag-and-drop on GitHub works — *Add file → Upload files*).
3. Commit. Cloudflare rebuilds automatically.

On deploy, Cloudflare runs `node tools/build_menu.mjs` (wired up in
`wrangler.toml`), which reads the spreadsheet and regenerates both
`public/menu.json` and `src/menu.js`. You never edit those two by hand,
and there is no CSV or Python step any more.

The spreadsheet needs an item column and a price column — those two are
the only ones actually required; everything else is optional. Header
names are matched loosely, so `Collection` / `Category`, `Item Name` /
`Name`, and `Price (PKR)` / `Price` all work. Rows with no name or price
are skipped rather than breaking the build, and a missing category
becomes "Other". If your descriptions carry macros inline (e.g. "macros
per square: Fat 19.5g, Protein 3.1g, Carbs 2.3g, Energy 198kcal"), those
figures are lifted into a clean macro strip automatically. If a future
sheet has dedicated `carbs` / `fat` / `protein` / `kcal` / `serving` /
`image` columns instead, those are used directly rather than parsed out
of the description.

### Product photos

Drop a picture into `public/img/` named after the product and it appears
on that product's card on the next deploy. Nothing to configure, and no
spreadsheet column to fill in.

The filename and the product name are both reduced to the same simple
form before being compared, so all of these match "Keto Pizza (7 inches
diameter)":

```
Keto Pizza (7 inches diameter).jpg
keto-pizza-7-inches-diameter.jpg
Keto Pizza 7 inches diameter.jpg
```

Prefer the hyphenated form. All three work, but hyphens keep spaces and
brackets out of the URL. It also sidesteps the names no filesystem will
accept as written — "Keto Egg Noodles / Chowmein (250gm raw)" contains a
slash.

| | |
|:---|:---|
| Formats | `.webp`, `.avif`, `.jpg`, `.jpeg`, `.png` |
| If two files match one product | `webp` wins, then `avif`, `jpg`, `jpeg`, `png` |
| Size | at least 900px on the long side |
| Shape | landscape, roughly 3:2 |
| Weight | under ~250KB each |

**Centre the food in the frame.** The same photo is cropped to a wide
strip on a computer and to a square on a phone, so anything near an edge
is lost in one view or the other.

A product with no photo of its own shows the Keto Genesis logo from
`public/img/placeholder.webp`. Four names are reserved and never treated
as products: `keto-mark`, `placeholder`, `favicon`, `og`.

The build log reports both directions — how many products have a photo,
and, loudly, any file that matched nothing, along with the product it
probably meant. A cross-listed product needs only one file, since both of
its rows share a name.

To preview locally before pushing:

```bash
npm install
npm run menu     # regenerate from the .xlsx
npm run dev      # serve with wrangler
```

Blank optional cells are fine. An item with no macros shows no macro
strip. Photos do not come from the spreadsheet at all — see **Product
photos** above — though if a future sheet ever gains an `image` column,
that column takes priority over the folder for those rows and accepts a
URL or a path relative to `public/`.

## Search

`scoreItem()` in `public/app.js` and `score()` in `src/index.js` (both at
the repo root — there is no separate `worker/` folder)
must surface the same items: typing a query and pressing Ask should never
disagree. They are near-identical, with one deliberate difference — the
page also searches an `alt` field, which holds the words it merges away
when it collapses a cross-listed product, and which the Worker does not
need because it scores the raw catalogue with both copies present. Both
call `norm()` first, which lowercases and treats any
punctuation as a space, so "brownie?" and "sugar-free" behave the same as
"brownie" and "sugar free". Both share a 246-word `STOPWORDS` set (NLTK English plus
shopping and Roman Urdu layers). Food words are never filtered. If you
edit one, edit the other and re-check that they still return the same
products. See SETUP.md for details.

## Search vs question

There is no guessing about intent: the customer presses **Ask** to reach
the chatbot. What the code decides is narrower — whether to filter the
list live while they type.

Results decide, not sentence length. If a query matches anything, the
matches are shown however long it is, so "sugar free chocolate brownie
box" still filters. Only when a query matches nothing does
`stillComposing()` choose between two failures: show "Nothing matches"
(right for a finished single word like "xyzzyplugh") or keep the menu up
(right for "do y" on the way to "do you have anything sweet"). Getting
this wrong made the page feel broken — an earlier version flashed
"Nothing matches" on nine of twenty-six keystrokes while typing a
question.

## Security

The LLM API key — `GROQ_API_KEY`, `GEMINI_API_KEY` or `CEREBRAS_API_KEY`,
whichever `LLM_PROVIDER` selects, currently Groq — lives only as a
Cloudflare Worker secret. It is
never in `config.js`, never in the repository, and never in a response
body: the Worker only ever returns `{ answer, items }`. `.dev.vars` is
gitignored so a local key cannot be committed by accident.

The headers in `public/_headers` cover static responses only. Cloudflare
does not apply them to anything Worker code generates, so `/ask` sets its
own `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` in
`json()`. If you add a response header there, add it in both places or
it will silently cover only half the site.

All customer text is escaped before it reaches the DOM, so a question
containing HTML renders as text. `public/_headers` sets a content
security policy that blocks inline scripts, framing, and unexpected
network destinations. No cookies, no local storage, no analytics, and no
customer data is stored anywhere.

## Costs

Everything here runs on free tiers: one Cloudflare Worker with static
assets (100,000 requests/day, no cold starts) and whichever LLM
`LLM_PROVIDER` selects — currently Groq (rate-limited rather than
metered), with Gemini's Flash free tier (no card, no expiry) and Cerebras
(1M tokens/day) as the alternatives. The only optional cost is a custom
domain.
