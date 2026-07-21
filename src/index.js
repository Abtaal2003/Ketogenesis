/**
 * Keto Genesis — the whole site in one Worker.
 *
 * Static files in public/ are served by Cloudflare directly. This code
 * only runs for requests that match no file, which in practice means
 * POST /ask.
 *
 * It exists for one reason: it holds the Cerebras API key, which must
 * never be shipped to a browser.
 *
 * Flow:  POST /ask  { q: "kuch meetha hai?" }
 *        -> retrieve the most relevant items; show up to 12, and
 *           ground the model's answer on the top 5 of them
 *        -> ask Cerebras to answer using ONLY those grounding items
 *        -> { answer, items }
 *
 * Only the retrieved items go into the prompt, never the whole menu.
 * That keeps each call small and well inside the free-tier context cap.
 */

import MENU from "./menu.js";

const MODEL = "gpt-oss-120b";

/* Longest customer question accepted, in characters. Anything longer is
   trimmed rather than rejected, so a rambling question still gets an
   answer instead of an error.

   Why 1000 is safe: the Cerebras free tier caps context at 8,192 tokens.
   The system prompt is roughly 250, five retrieved items with full
   descriptions roughly 700, and 200 are reserved for the reply. That
   leaves around 7,000 tokens (~28,000 characters) of headroom, so 1,000
   is generous rather than tight. Raise MAX_QUERY_CHARS in wrangler.toml
   if you ever need more; the ceiling is the context cap, not this. */
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
- Answer ONLY from the product list given in the customer's message.
- Never invent a product, price, ingredient, or macro figure. If it is
  not in the list, you do not know it.
- If the list does not answer the question, say you are not sure and
  point them to the menu or to WhatsApp.

## Things only the team can confirm
Delivery areas, delivery times, stock on a given day, custom orders,
bulk pricing, and payment. For any of these, give the WhatsApp number
and suggest they message.

## Style
- Under 60 words. This is a website, not an email.
- Match the customer's language: English, Urdu, or Roman Urdu.
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

  if (hay.includes(q)) return 100;            // whole phrase present

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
  if (!items.length) return "(no matching products found)";
  return items
    .map((i) => {
      const m = i.macros
        ? ` Macros per ${i.serving || "serving"}: ${Object.entries(i.macros)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}.`
        : "";
      return `- ${i.name} (Rs ${i.price}, ${i.cat}): ${i.desc || "no description"}.${m}`;
    })
    .join("\n");
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

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

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
    // Why the split: the Cerebras free tier caps context at 8,192 tokens,
    // so the prompt can only afford a handful of full item descriptions.
    // Display has no such cost, so it can be more generous.
    const DISPLAY_K = 10000; // shown below the answer
    const GROUND_K = 5;   // sent into the prompt
    const items = retrieve(q, DISPLAY_K);
    const grounded = items.slice(0, GROUND_K);

    if (!env.CEREBRAS_API_KEY) {
      // No key configured: still useful, just without the written answer.
      return json({ answer: null, items }, 200);
    }

    try {
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CEREBRAS_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.CEREBRAS_MODEL || MODEL,
          // gpt-oss-120b is a REASONING model: this budget covers its
          // internal reasoning AND the visible answer. At 200 a harder
          // question (translating Roman Urdu, comparing three items)
          // spent the lot on reasoning and returned empty content, which
          // read as "no answer" and fell back to the plain item list.
          // The model's own ceiling is 40,960, so 2000 is still tiny.
          // Brevity is enforced by the system prompt, not by this.
          max_completion_tokens: 2000,
          // Keep reasoning short: this is a menu lookup, not a maths problem.
          reasoning_effort: "low",
          temperature: 0.3,
          messages: [
            { role: "system", content: systemPrompt(env) },
            {
              role: "user",
              content: `Products that may be relevant:\n${describe(grounded)}\n\nCustomer's message: ${q}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        console.log("Cerebras error", res.status, await res.text());
        return json({ answer: null, items }, 200);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const answer = (choice?.message?.content || "").trim();

      if (!answer) {
        // Silent before: an empty answer just became a fallback with no
        // trace of why. finish_reason "length" means the token budget ran
        // out, which is the one failure worth being able to spot.
        console.log(
          "Empty answer from model. finish_reason:", choice?.finish_reason,
          "usage:", JSON.stringify(data.usage)
        );
      }
      return json({ answer: answer || null, items }, 200);
    } catch (err) {
      console.log("Cerebras call failed", err);
      // Degrade gracefully: the site shows the matched items instead.
      return json({ answer: null, items }, 200);
    }
  },
};
