/**
 * Keto Genesis — the whole site in one Worker.
 *
 * Static files in public/ are served by Cloudflare directly. This code
 * only runs for requests that match no file, which in practice means
 * POST /ask.
 *
 * It exists for one reason: it holds the LLM provider's API key, which
 * must never be shipped to a browser.
 *
 * Flow:  POST /ask  { q: "kuch meetha hai?" }
 *        -> retrieve every item that matches, return them all for the
 *           page to show, and ground the model's answer on the top 5
 *        -> ask the selected provider (Cerebras or Gemini) to answer
 *           using ONLY those grounding items
 *        -> { answer, items }
 *
 * Only the retrieved items go into the prompt, never the whole menu.
 * That keeps each call small and well inside the free-tier context cap.
 */

import MENU from "./menu.js";

/* ---------- provider switch ----------
   Which LLM backend answers /ask. Three are wired up:

     "cerebras" — the original. Free tier: 1M tokens/day, gpt-oss-120b.
     "gemini"   — Google Gemini. Free tier: no card, no expiry, generous
                  daily limits on the Flash models.
     "groq"     — Groq. Free tier: no card, rate-limited (not metered)
                  daily quota, runs the same gpt-oss-120b as Cerebras but
                  on Groq's own LPU hardware. Useful as a fallback when
                  Gemini returns 503 "high demand" or Cerebras' quota is
                  spent for the day.

   Switch by setting LLM_PROVIDER in wrangler.toml [vars] to "cerebras",
   "gemini", or "groq". If unset, it defaults to "cerebras" so nothing
   breaks. Each provider reads its own API key secret, so you can have
   all three keys set and flip between them with just the var — no code
   change, no redeploy of secrets.

   Defaults live here; every value can be overridden from wrangler.toml
   so you never have to touch code to retune. */
const PROVIDER = "cerebras"; // fallback if env.LLM_PROVIDER is unset

const CEREBRAS_MODEL = "gpt-oss-120b";

// Same model family as Cerebras (gpt-oss-120b), just served from Groq's
// LPU hardware instead — handy as a drop-in fallback. Groq also hosts
// llama-3.3-70b-versatile and others; override with GROQ_MODEL in
// wrangler.toml if you want to try a different one.
const GROQ_MODEL = "openai/gpt-oss-120b";

// gemini-3.5-flash is the current recommended free-tier Flash model.
// gemini-3.1-flash-lite is the lighter, higher-rate-limit alternative.
// Confirm the exact model ID for your account in Google AI Studio, since
// Google renames these between generations. Override with GEMINI_MODEL
// in wrangler.toml.
const GEMINI_MODEL = "gemini-3.5-flash";

/* How hard Gemini thinks before it starts writing. This is the direct
   counterpart of reasoning_effort on the Cerebras call below, and it is
   the single biggest lever on how long a customer waits.

   Gemini 3 models reason internally before emitting any visible text,
   and gemini-3.5-flash defaults to "medium". For a menu lookup that
   reasoning is pure latency, so this drops it to "low".

     "minimal" — closest to thinking off; fastest
     "low"     — minimises latency and cost
     "medium"  — the model default
     "high"    — deepest reasoning, slowest first token
     "off"     — do not send thinkingConfig at all (rollback switch)

   IMPORTANT: thinkingLevel is the Gemini 3 parameter. The 2.5 series
   uses thinkingBudget (a token count) instead and rejects this one, so
   if GEMINI_MODEL is ever pointed back at a 2.5 model, set this to
   "off". Override with GEMINI_THINKING_LEVEL in wrangler.toml. */
const GEMINI_THINKING_LEVEL = "off";

/* Longest customer question accepted, in characters. Anything longer is
   trimmed rather than rejected, so a rambling question still gets an
   answer instead of an error.

   Why 1000 is safe: it is sized against Cerebras, which is much the
   tighter of the two providers, so it is comfortable on either. The
   Cerebras free tier caps context at 8,192 tokens. The system prompt is
   roughly 250, five retrieved items with full descriptions roughly 700,
   and 200 are reserved for the reply. That leaves around 7,000 tokens
   (~28,000 characters) of headroom, so 1,000 is generous rather than
   tight. Gemini's Flash models allow far more again, so switching
   providers never makes this limit the binding constraint. Raise
   MAX_QUERY_CHARS in wrangler.toml if you ever need more; the ceiling is
   the context cap, not this. */
const MAX_QUERY = 1000;

/* ---------- the prompt ----------
   Two kinds of knowledge, deliberately separated.

   Business facts (number, hours, location, how ordering works) are fixed
   and safe to state, so they live here. Product facts (names, prices,
   macros) change with the catalogue and must only come from the items
   retrieved for this question — inventing a price is the one failure
   that would actually cost a customer.

   Examples are included because the rules alone were not enough: the
   model kept refusing to give the WhatsApp number simply because the
   prompt never contained it. */
function systemPrompt(env) {
  const raw = env.ORDER_NUMBER || "923215374880";
  // 923215374880 -> +92 321 5374880
  const pretty = raw.length === 12
    ? `+${raw.slice(0, 2)} ${raw.slice(2, 5)} ${raw.slice(5)}`
    : `+${raw}`;

  return `You are the assistant on the Keto Genesis website. You help customers understand the menu and then hand them over to the team.

## About the business — you may state any of this freely
- Keto Genesis, "The Fat Burning Fuel Factory", trading since 2020.
- A keto food producer in Bahria Town Phase 7, Rawalpindi.
- Open 9:00 am to 5:00 pm.
- WhatsApp and phone: ${pretty}. This is the number for orders, for
  speaking to a person, and for anything you cannot answer.
- To order, a customer adds items on this page and taps "Order on
  WhatsApp", which opens a chat with their order already typed out.

## About products — strict
The customer's message contains two lists.
- FULL MENU: every product we sell, with its price and category. This
  is the complete, always-present list of what exists. You may state
  any name, price, or category from it freely.
- DETAIL ON LIKELY MATCHES: fuller description and macros for whichever
  items most likely answer this question. This is the ONLY source for
  descriptions, ingredients, or macros — never invent one, even for an
  item you can see in FULL MENU but that has no entry here.
- If what the customer is asking about isn't in FULL MENU at all, say
  you don't think we carry it and point them to WhatsApp to confirm.
- If it's in FULL MENU but has no entry in DETAIL ON LIKELY MATCHES,
  confirm it exists and its price, but say you don't have the exact
  description or macros to hand and suggest WhatsApp for specifics.

## Things only the team can confirm
Delivery areas, delivery times, stock on a given day, custom orders,
bulk pricing, and payment. For any of these, give the WhatsApp number
and suggest they message.

## Style
- Under 60 words. This is a website, not an email.
- Match the language of the CUSTOMER'S MESSAGE only: English, Urdu, or
  Roman Urdu. The product list often contains Roman Urdu product names;
  that is not a signal about which language to reply in. If the customer
  writes in English, reply in English even when every product name in
  the list is Roman Urdu.
- Product names are never translated. Write each one exactly as it
  appears in the list, whatever language the rest of your reply is in.
- Write prices as "Rs 2,800", with the comma.
- Plain text only. No markdown, no bullet lists, no links.
- Warm and brief. Never push a sale.

## Examples

Customer: what is your whatsapp number
You: You can reach us on WhatsApp at ${pretty}. We are open 9:00 am to 5:00 pm and happy to help with anything.

Customer: I want to talk to someone
You: Of course. Message us on WhatsApp at ${pretty} between 9:00 am and 5:00 pm and one of the team will reply.

Customer: do you deliver to G-11
You: Delivery areas are best confirmed by the team. Message us on WhatsApp at ${pretty} and they will let you know right away.

Customer: kya aap ke paas pizza hai
You: Ji haan, Keto Pizza Rs 1,400 ka hai. Add karke "Order on WhatsApp" tap kar dein.

Customer: do you have pasta
You: I am not sure we have pasta. Have a look through the menu, or message us on WhatsApp at ${pretty} and the team will confirm.`;
}

/* ---------- retrieval ----------
   Byte-for-byte the same scoring as scoreItem() in public/app.js. Keep
   the two in step: if they drift, typing a query and pressing Ask on the
   same query start surfacing different items, which reads as a bug to a
   customer.                                                            */
const STOPWORDS = new Set([
  "aap", "aapka", "about", "above", "acha", "achi", "after", "again",
  "against", "agar", "alaikum", "all", "and", "any", "anyone", "anything",
  "apka", "are", "aren", "ask", "assalam", "aur", "availability",
  "available", "baji", "bata", "batao", "because", "been", "before",
  "being", "below", "between", "bhai", "bhej", "both", "but", "buy",
  "buying", "can", "chahie", "chahiye", "cost", "costs", "couldn", "dedo",
  "deliver", "delivery", "dena", "deni", "did", "didn", "does", "doesn",
  "doing", "don", "down", "during", "each", "everything", "few", "for",
  "from", "further", "get", "give", "got", "had", "hadn", "hai", "hain",
  "hamara", "hamari", "has", "hasn", "have", "haven", "having", "hello",
  "her", "here", "hers", "herself", "hey", "him", "himself", "his", "hoga",
  "hogi", "hoon", "hota", "hoti", "how", "hum", "into", "isn", "its",
  "itself", "just", "kab", "kahan", "kaisa", "kaise", "kar", "karo",
  "kaun", "kaunsa", "kia", "kindly", "kitna", "kitne", "kitni", "know",
  "koi", "konsa", "kuch", "kuchh", "kya", "lekin", "lena", "leni", "look",
  "looking", "madam", "main", "many", "mein", "mera", "meri", "mightn",
  "mil", "milega", "milegi", "milta", "milti", "more", "most", "much",
  "mujhe", "mustn", "myself", "nahi", "nahin", "need", "needn", "needs",
  "nor", "not", "now", "off", "once", "only", "order", "ordering",
  "orders", "other", "our", "ours", "ourselves", "out", "over", "own",
  "phir", "please", "price", "prices", "pricing", "purchase", "question",
  "raha", "rahi", "rate", "rates", "sab", "sabhi", "sakta", "sakti",
  "salam", "same", "send", "shan", "she", "should", "shouldn", "show",
  "sir", "some", "someone", "something", "such", "tell", "tha", "than",
  "thank", "thanks", "that", "the", "theek", "their", "theirs", "them",
  "themselves", "then", "there", "these", "they", "thi", "thik", "this",
  "those", "through", "too", "tum", "tumhara", "under", "until", "very",
  "wala", "walaikum", "walay", "wali", "want", "wants", "was", "wasn",
  "were", "weren", "what", "when", "where", "which", "while", "who",
  "whom", "why", "will", "with", "woh", "wouldn", "yeh", "you", "your",
  "yours", "yourself", "yourselves", "zara"
]);

/* Normalise before matching: lowercase, then treat any punctuation as a
   space. Without this, "brownie?" and "sugar-free" both scored zero,
   because the query term kept its trailing "?" or its hyphen while the
   text did not. \p{L}/\p{N} keep letters and digits of ANY script, so
   Urdu descriptions would survive this unchanged.                    */
function norm(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function score(item, query) {
  const q = norm(query);
  if (!q) return 1;

  const name = norm(item.name);
  const hay = norm(`${item.name} ${item.desc} ${item.cat}`);

  // Gated to 3+ chars: below that, hay.includes(q) matches almost every
  // item (nearly everything contains a given single letter), so a 1-2
  // char query would score ~everything 100 instead of falling through to
  // the empty-terms path below and correctly matching nothing yet.
  if (q.length > 2 && hay.includes(q)) return 100;   // whole phrase present

  // Drop filler words. If the query is nothing but filler, fall back to
  // the raw words so a customer still gets something rather than nothing.
  // 3+ chars: two-letter fragments match inside unrelated words
  // ("do" inside "alfredo"). Short queries are already handled above
  // by the whole-phrase check.
  const raw = q.split(/\s+/).filter((w) => w.length > 2);
  const words = raw.filter((w) => !STOPWORDS.has(w));
  const terms = words.length ? words : raw;
  if (!terms.length) return 0;

  let s = 0;
  for (const w of terms) {
    if (name.includes(w)) s += 2;
    else if (hay.includes(w)) s += 1;
  }
  return s;
}

function retrieve(query, k = 5) {
  return MENU.map((item) => ({ item, s: score(item, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.item);
}

function describe(items) {
  if (!items.length) {
    return "(nothing scored a close wording match — rely on FULL MENU above for what exists; do not guess at descriptions or macros)";
  }
  return items
    .map((i) => {
      const m = i.macros
        ? ` Macros per ${i.serving || "serving"}: ${Object.entries(i.macros)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}.`
        : "";
      // Comma-grouped, matching rs() in public/app.js exactly. The prompt
      // asks for prices written as "Rs 2,800"; giving the model "Rs 2800"
      // here made it do that formatting itself, which it did
      // inconsistently. Formatting the input is more reliable than
      // instructing the output, and it means the price the model quotes
      // is character-for-character the one on the card.
      const price = i.price.toLocaleString("en-PK");
      return `- ${i.name} (Rs ${price}, ${i.cat}): ${i.desc || "no description"}.${m}`;
    })
    .join("\n");
}

/* Compact, one-line-per-item version of the ENTIRE catalogue: name,
   price, category, nothing else. This goes into every prompt regardless
   of what the customer typed, so the model always knows the complete set
   of what exists. A query that scores zero in retrieve() — a category
   word like "dessert" that never appears verbatim in any name/desc/cat,
   or a Roman Urdu word like "meetha" — no longer means the model has
   nothing to work with. It can still see every product by name and
   reason about which ones plausibly match, the way a person reading the
   menu would.

   Names are copied verbatim, same rule and same reason as describe():
   several product names are themselves Roman Urdu ("Keto Zera
   Biscuits"), and the system prompt already forbids translating a
   product name.

   Cross-listed items (the same product filed under two categories, e.g.
   the Pizza in both Savoury Stuff and Italian Cuisine) are deduplicated
   by name here so one product doesn't cost two lines in the prompt. The
   customer-facing category browse in public/app.js is untouched by this
   — it still shows the item in both places; this only affects what goes
   into the LLM call. */
function compactCatalog() {
  const seen = new Set();
  const lines = [];
  for (const i of MENU) {
    if (seen.has(i.name)) continue;
    seen.add(i.name);
    lines.push(`- ${i.name} — Rs ${i.price.toLocaleString("en-PK")} (${i.cat})`);
  }
  return lines.join("\n");
}

/* ---------- same-origin guard ----------
   The page and this endpoint now share an origin, so there is nothing to
   configure: a request is allowed if its Origin header matches the host
   it was sent to. That works on workers.dev, on a custom domain, and
   locally, with no variable to set and nothing to keep in sync.

   Requests with no Origin at all (curl, bots) are refused, which is the
   opposite of the old behaviour and the safer default.               */
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/* The security headers in public/_headers apply ONLY to static assets.
   Cloudflare does not apply them to responses generated by Worker code,
   even when the request path would match a rule in that file, so every
   response built here has to carry its own. Most of that block is
   meaningless for a JSON body; nosniff is the one that matters. */
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/* ---------- providers ----------
   Each function takes the system prompt and the user message, calls its
   API, and returns the same shape:

     { answer, finishReason, usage }   on a successful HTTP call
                                       (answer may still be "" — an empty
                                        completion, which the caller logs)

   A non-OK HTTP status or a network error throws, so the caller's single
   try/catch degrades to showing the matched items either way. Keeping
   the return shape identical is what lets the handler stay
   provider-agnostic below.                                            */

async function askCerebras(env, system, user) {
  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CEREBRAS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.CEREBRAS_MODEL || CEREBRAS_MODEL,
      // gpt-oss-120b is a REASONING model: this budget covers its
      // internal reasoning AND the visible answer. At 200 a harder
      // question (translating Roman Urdu, comparing three items) spent
      // the lot on reasoning and returned empty content. The model's own
      // ceiling is 40,960, so 2000 is still tiny. Brevity is enforced by
      // the system prompt, not by this.
      max_completion_tokens: 2000,
      // Keep reasoning short: this is a menu lookup, not a maths problem.
      reasoning_effort: "low",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cerebras HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    answer: (choice?.message?.content || "").trim(),
    finishReason: choice?.finish_reason,
    usage: data.usage,
  };
}

// Groq's endpoint is OpenAI-compatible chat/completions, same shape as
// Cerebras above — that's why this function is almost identical to
// askCerebras. reasoning_effort is honoured the same way, since the
// default model here (gpt-oss-120b) is the same reasoning model.
async function askGroq(env, system, user) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL || GROQ_MODEL,
      // Same reasoning-budget trap as Cerebras: too low and a harder
      // question spends the whole budget thinking and returns empty
      // content. See the comment on the Cerebras call above.
      max_completion_tokens: 2000,
      reasoning_effort: "low",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.log("Groq HTTP status:", String(res.status));
    console.log("Groq error body:", body.slice(0, 800));
    throw new Error(`Groq HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    answer: (choice?.message?.content || "").trim(),
    finishReason: choice?.finish_reason,
    usage: data.usage,
  };
}

async function askGemini(env, system, user) {
  const model = env.GEMINI_MODEL || GEMINI_MODEL;
  // "off" (or any empty value) omits thinkingConfig from the request
  // entirely, restoring the exact body this Worker sent before the
  // setting existed. That is the rollback switch: one word in
  // wrangler.toml, no code edit.
  const raw = (env.GEMINI_THINKING_LEVEL || GEMINI_THINKING_LEVEL)
    .trim()
    .toLowerCase();
  const level = raw === "off" ? "" : raw;
  // The key goes in the x-goog-api-key header, never the URL, so it does
  // not end up in logs. system_instruction carries the system prompt;
  // contents carries the customer's message.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.3,
          // Only sent when a level is configured. Spreading an empty
          // object leaves the key out completely rather than sending
          // thinkingConfig: null, which Google would reject.
          ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
          // Thinking tokens are drawn from THIS budget, the same trap as
          // the Cerebras reasoning budget above: set it too low and a
          // harder question spends the lot on thinking and comes back
          // with empty content. Brevity is enforced by the system
          // prompt, not by this, so it stays generous.
          maxOutputTokens: 2000,
        },
      }),
    }
  );

  if (!res.ok) {
    // Log the status and Google's error body as separate PLAIN STRINGS.
    // Packing them into an Error and logging the object loses them: the
    // Workers log pipeline renders the stack but drops the message, which
    // is exactly how a 400 here turned into an unreadable log line.
    const body = await res.text();
    console.log("Gemini HTTP status:", String(res.status));
    console.log("Gemini error body:", body.slice(0, 800));
    console.log("Gemini model was:", model, "thinkingLevel was:", level || "(omitted)");
    throw new Error(`Gemini HTTP ${res.status}`);
  }

  const data = await res.json();
  const cand = data.candidates?.[0];
  // Gemini splits the reply into parts; join their text back together.
  const answer = (cand?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  return {
    answer,
    finishReason: cand?.finishReason,
    usage: data.usageMetadata,
  };
}

/* Pick the provider and confirm its key is present. Returns null when no
   key is configured, so the caller can fall back to the item list. */
function pickProvider(env) {
  const name = (env.LLM_PROVIDER || PROVIDER).toLowerCase();
  if (name === "gemini") {
    return env.GEMINI_API_KEY ? { name, call: askGemini } : null;
  }
  if (name === "groq") {
    return env.GROQ_API_KEY ? { name, call: askGroq } : null;
  }
  // default / "cerebras"
  return env.CEREBRAS_API_KEY ? { name: "cerebras", call: askCerebras } : null;
}

// Which secret name to point someone at when pickProvider() returns null.
const PROVIDER_KEY_NAME = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Static files are handled by Cloudflare before this runs. Anything
    // else that is not the Ask endpoint is genuinely missing.
    if (pathname !== "/ask") return json({ error: "Not found" }, 404);

    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);

    let q = "";
    try {
      q = String((await request.json()).q || "").trim();
    } catch {
      return json({ error: "Bad JSON" }, 400);
    }
    if (!q) return json({ error: "Empty question" }, 400);

    const limit = Number(env.MAX_QUERY_CHARS) || MAX_QUERY;
    if (q.length > limit) q = q.slice(0, limit);

    // Retrieve a wider set to SHOW the customer, but ground the model's
    // written answer on only the top few. The list is already sorted
    // best-first, so the grounding set is just its head — no re-scoring.
    // Why the split: a small prompt is cheap and fast on any provider,
    // and Cerebras in particular caps context tightly, so the prompt only
    // carries a handful of full item descriptions. Display has no such
    // cost, so it can be generous.
    const DISPLAY_K = 10000; // shown below the answer
    const GROUND_K = 5;   // sent into the prompt
    const items = retrieve(q, DISPLAY_K);
    const grounded = items.slice(0, GROUND_K);

    const provider = pickProvider(env);
    if (!provider) {
      // No key for the selected provider: still useful, just without the
      // written answer. The site shows the matched items instead. Log it,
      // since this is otherwise indistinguishable in the response from a
      // provider that's working but chose to say nothing.
      const wanted = (env.LLM_PROVIDER || PROVIDER).toLowerCase();
      const keyName = PROVIDER_KEY_NAME[wanted] || "CEREBRAS_API_KEY";
      console.log(`No API key configured for provider "${wanted}". Set it with: npx wrangler secret put ${keyName}`);
      return json({ answer: null, items }, 200);
    }

    const system = systemPrompt(env);
    // FULL MENU is the complete catalogue, compact, always present — a
    // retrieval miss can never leave the model with nothing to answer
    // from. DETAIL ON LIKELY MATCHES is the existing retrieve() output,
    // unchanged: full descriptions and macros for whatever scored a hit.
    // See compactCatalog() above for why both are here.
    const user = `FULL MENU (every product, name — price (category)):\n${compactCatalog()}\n\nDETAIL ON LIKELY MATCHES (fuller description and macros for items that may answer this question):\n${describe(grounded)}\n\nCustomer's message: ${q}`;

    try {
      const { answer, finishReason, usage } = await provider.call(env, system, user);

      if (!answer) {
        // An empty completion falls back to the item list. Log why: for
        // Cerebras a finish_reason of "length" means the token budget ran
        // out; for Gemini "MAX_TOKENS" or "SAFETY" is the usual cause.
        console.log(
          `Empty answer from ${provider.name}. finishReason:`, finishReason,
          "usage:", JSON.stringify(usage)
        );
      }
      return json({ answer: answer || null, items }, 200);
    } catch (err) {
      console.log(`${provider.name} call failed`, err);
      // Degrade gracefully: the site shows the matched items instead.
      return json({ answer: null, items }, 200);
    }
  },
};
