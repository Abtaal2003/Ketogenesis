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
 *        -> retrieve the 5 most relevant items from the menu
 *        -> ask Cerebras to answer using ONLY those items
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

const SYSTEM_PROMPT = `You are the assistant for Keto Genesis, a keto food producer in Bahria Town Phase 7, Rawalpindi, trading since 2020. You answer customer questions on the website.

Rules:
- Answer ONLY from the product list given to you. Never invent products, prices, ingredients, or macros.
- If the list doesn't answer the question, say you're not sure and suggest browsing the menu or messaging us on WhatsApp.
- You cannot take orders, addresses, or payments. Tell customers to add items and tap "Order on WhatsApp".
- Keep replies under 60 words.
- Prices are Pakistani Rupees, written as "Rs 850".
- Match the customer's language: English, Urdu, or Roman Urdu.
- Plain text only. No markdown, no bullet lists, no links.
- Be warm and brief. No hard selling.`;

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

    const items = retrieve(q);

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
          max_completion_tokens: 200,
          temperature: 0.3,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Products that may be relevant:\n${describe(items)}\n\nCustomer's message: ${q}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        console.log("Cerebras error", res.status, await res.text());
        return json({ answer: null, items }, 200);
      }

      const data = await res.json();
      const answer = (data.choices?.[0]?.message?.content || "").trim();
      return json({ answer: answer || null, items }, 200);
    } catch (err) {
      console.log("Cerebras call failed", err);
      // Degrade gracefully: the site shows the matched items instead.
      return json({ answer: null, items }, 200);
    }
  },
};
