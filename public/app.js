/* ------------------------------------------------------------------
   Keto Genesis menu site.

   menu.json ships with the page, so browsing, filtering and search all
   run in the browser with no network calls. Only the Ask button talks
   to the Worker, and the site stays fully usable if that ever fails.
   ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

// config.js declares these. If it failed to load, keep the menu working
// rather than throwing a ReferenceError and rendering nothing.
const CFG_NUMBER = typeof ORDER_NUMBER === "string" ? ORDER_NUMBER : "";
const CFG_ASK = typeof ASK_URL === "string" ? ASK_URL : "";

let MENU = [];
let activeCat = "All";
let cart = [];

// Bumped on every new question and on every keystroke. A reply whose
// ticket no longer matches is stale and gets discarded, so overlapping
// or out-of-order responses can never overwrite a newer one.
let askTicket = 0;

const rs = (n) => "Rs " + n.toLocaleString("en-PK");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- theme ----------
   public/theme-init.js already set the initial theme before paint (it is
   its own file rather than an inline block because the CSP forbids
   inline scripts — see the comment in that file). Here we wire the
   toggle button and remember the choice. If the
   visitor never taps the button, we keep following their OS setting even
   if it changes mid-visit (e.g. an auto night switch). Once they choose
   manually, that wins and persists. localStorage works here because this
   is a real page on Cloudflare, not a sandboxed artifact. */
function initTheme() {
  const btn = $("theme");
  if (!btn) return;

  const apply = (dark) =>
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

  btn.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") !== "dark";
    apply(dark);
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch {}
  });

  // Follow the OS only while no manual choice is stored.
  try {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", (e) => {
      if (!localStorage.getItem("theme")) apply(e.matches);
    });
  } catch {}
}

/* ---------- boot ---------- */
async function boot() {
  initTheme();
  try {
    const res = await fetch("menu.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    MENU = await res.json();
  } catch {
    $("list").innerHTML =
      '<p class="empty">The menu could not load.<br>Please refresh the page.</p>';
    return;
  }

  const cats = ["All", ...new Set(MENU.map((m) => m.cat))];
  $("chips").innerHTML = cats.map((c) =>
    `<button class="chip" aria-pressed="${c === "All"}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join("");
  initChipScroll();

  $("askBtn").hidden = !CFG_ASK;
  setHint(false);
  $("waPlain").href = `https://wa.me/${CFG_NUMBER}`;

  render();
  renderCart();
}

/* ---------- category row ----------
   The chip row scrolls horizontally, but its scrollbar is hidden, so
   nothing indicated that more categories existed past the right edge —
   the row just appeared to end. CSS draws a fade there whenever .more is
   set; this decides when that is true.

   "More to the right" rather than "is scrollable", so the fade clears
   once the customer reaches the end and never shows at all on a screen
   wide enough to fit every chip. The 2px slack absorbs the fractional
   scroll positions browsers report at high zoom or on retina displays,
   which would otherwise leave the fade stuck on at the end of the row. */
function initChipScroll() {
  const row = $("chips");
  if (!row) return;

  const update = () => {
    const more = row.scrollWidth - row.clientWidth - row.scrollLeft > 2;
    row.classList.toggle("more", more);
  };

  row.addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

/* ---------- local search ----------
   Scored, not all-or-nothing. Requiring every word to appear meant
   "sugar free" matched nothing: some items say "no added sugar", others
   say "gluten-free", none say both. This mirrors the Worker's scoring so
   typing and pressing Ask surface the same items.                     */
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

function scoreItem(item, query) {
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

function macroStrip(m, serving) {
  if (!m) return "";
  const label = { carbs: "carbs", fat: "fat", protein: "protein", kcal: "energy" };
  const parts = Object.entries(m).map(([k, v]) =>
    `<b><i>${label[k] || esc(k)}</i> ${v}${k === "kcal" ? " kcal" : "g"}</b>`);
  if (serving) parts.push(`<b><i>per</i> ${esc(serving)}</b>`);
  return `<p class="macros">${parts.join("")}</p>`;
}

function card(m) {
  const img = m.image
    ? `<img class="thumb" src="${esc(m.image)}" alt="" loading="lazy">`
    : "";
  return `<article class="item">
  ${img}
  <div class="body">
    <div class="row">
      <h2 class="name">${esc(m.name)}</h2>
      <span class="price">${rs(m.price)}</span>
    </div>
    ${m.desc ? `<p class="desc">${esc(m.desc)}</p>` : ""}
    ${macroStrip(m.macros, m.serving)}
    <button class="add" data-name="${esc(m.name)}" data-cat="${esc(m.cat)}"
            data-price="${m.price}">Add to order</button>
  </div>
</article>`;
}

/* Distinguishing a search from a question.

   Word count alone was wrong: "sugar free chocolate brownie box" is five
   words and a perfectly good product search, but it was being treated as
   a question and the menu stopped filtering.

   So results decide first. If the query matches anything it was a search,
   however long it is, and the matches are shown.

   Only when it matches NOTHING do we choose between two failures:

     "Nothing matches"  - a finished search that failed. Correct for a
                          single typed-out word like "xyzzyplugh".
     keep the menu up   - the customer is mid-sentence. Correct for "do y"
                          on the way to "do you have anything sweet", and
                          for anything containing a question mark.

   Getting this wrong is what made the page feel broken: filtering every
   keystroke of a question flashed "Nothing matches" on nine of twenty-six
   keystrokes.                                                          */
function stillComposing(q) {
  if (q.includes("?")) return true;                    // clearly a question
  if (q.length < 3) return true;                       // barely started
  if (q.split(/\s+/).filter(Boolean).length > 1) return true;   // mid-sentence
  // A lone filler word ("kya", "price", "what") is the first word of a
  // question, not a search that failed.
  return norm(q).split(/\s+/).every((t) => t.length < 3 || STOPWORDS.has(t));
}

function setHint(questionMode) {
  // Four states, not three: questionMode can now be reached with the Ask
  // feature switched off, and telling someone to press a button that is
  // not on the page would be worse than the blank menu this replaced.
  $("hint").textContent =
    questionMode && CFG_ASK ? "That looks like a question. Press Ask."
    : questionMode ? "Keep typing to filter the menu."
    : CFG_ASK ? "Typing filters instantly. Press Ask for a written answer."
    : "Type to filter the menu instantly.";
}

function render(rows) {
  const q = $("q").value.trim();
  let questionMode = false;

  if (!rows) {
    const pool = MENU.filter((m) => activeCat === "All" || m.cat === activeCat);
    if (!q) {
      rows = pool;                                    // browsing: catalogue order
    } else {
      rows = pool
        .map((m) => ({ m, s: scoreItem(m, q) }))      // searching: best first
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((r) => r.m);

      // Deliberately NOT gated on CFG_ASK. config.js documents setting
      // ASK_URL to "" as a supported configuration where browsing and
      // search still work — but with the gate here, a site in that state
      // blanked the whole menu to "Nothing matches" on the first
      // keystroke, because a 1-2 char query scores 0 everywhere. The
      // safety net is a search concern; it must not depend on an
      // unrelated feature being switched on. setHint() below picks the
      // wording that suits whichever configuration is running.
      if (!rows.length && stillComposing(q)) {
        rows = pool;            // mid-sentence, not a failed search
        questionMode = true;
      }
    }
  }

  setHint(questionMode);

  $("count").textContent = rows.length
    ? `${rows.length} item${rows.length > 1 ? "s" : ""}` : "";

  $("list").innerHTML = rows.length
    ? rows.map(card).join("")
    : `<p class="empty">Nothing matches &ldquo;${esc(q)}&rdquo;.<br>
         Try another word${CFG_ASK ? ", or press Ask" : ""}.</p>`;
}

/* ---------- order ---------- */
function renderCart() {
  const n = cart.reduce((s, c) => s + c.qty, 0);
  const total = cart.reduce((s, c) => s + c.qty * c.price, 0);

  $("bar").classList.toggle("up", n > 0);
  $("cartN").textContent = `${n} item${n === 1 ? "" : "s"} in your order`;
  $("cartT").textContent = rs(total);

  const lines = cart.map((c) => `- ${c.name} x${c.qty} — ${rs(c.qty * c.price)}`);
  const text = "Assalam o Alaikum! I'd like to place this order:\n\n"
    + lines.join("\n") + `\nTotal: ${rs(total)}`;
  $("go").href = `https://wa.me/${CFG_NUMBER}?text=${encodeURIComponent(text)}`;
}

/* ---------- ask ----------
   Models reach for markdown however firmly the prompt says not to; the
   WhatsApp version of this project emitted "**Rs 450**" regularly. Escape
   first so any real HTML is neutralised, then turn the leftover literal
   asterisks into emphasis. Doing it in that order keeps it XSS-safe. */
function formatAnswer(text) {
  return esc(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,!?]|$)/g, "$1<strong>$2</strong>")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-+]\s+/gm, "• ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}
function bubble(html) {
  $("answer").innerHTML =
    `<div class="answer"><span class="who">Keto Genesis</span>${html}</div>`;
  revealAnswer();
}

/* The answer renders below the sticky bar but above the list. If the
   customer asked while scrolled down the page, it would appear
   off-screen and only the list would visibly change. Scroll it into
   view, allowing for the sticky bar's height. */
function revealAnswer() {
  const el = $("answer");
  const bar = document.querySelector(".askbar");
  const top = el.getBoundingClientRect().top;
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 12;
  if (top < offset || top > window.innerHeight * 0.6) {
    window.scrollBy({ top: top - offset, behavior: "smooth" });
  }
}

async function ask() {
  const q = $("q").value.trim();
  if (!q || !CFG_ASK) return;

  const ticket = ++askTicket;
  $("askBtn").disabled = true;
  bubble('<span class="dots"><span></span><span></span><span></span></span>');

  try {
    const res = await fetch(CFG_ASK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q }),
    });
    const data = await res.json();
    if (ticket !== askTicket) return;      // superseded; drop this reply

    // An error from the Worker still parses as JSON, so `res.json()`
    // succeeding is not the same as the request having worked. Without
    // this check a 403 or 400 fell through to the line below: the
    // customer was told "Here are the closest matches" while `data.items`
    // was undefined, so nothing re-rendered and the sentence pointed at a
    // menu that had not changed.
    if (!res.ok || data.error) {
      bubble("We couldn't answer that just now. The menu below still works, "
           + "or message us on WhatsApp.");
      return;                              // `finally` still frees the button
    }

    bubble(data.answer
      ? formatAnswer(data.answer)
      : "Here are the closest matches from our menu.");

    if (Array.isArray(data.items) && data.items.length) {
      setCategory("All");          // results can span categories
      render(data.items);
    }
  } catch {
    if (ticket === askTicket) {
      bubble("We couldn't answer that just now. The menu below still works, "
           + "or message us on WhatsApp.");
    }
  } finally {
    if (ticket === askTicket) $("askBtn").disabled = false;
  }
}

/* ---------- events ---------- */
$("q").addEventListener("input", () => {
  const q = $("q").value.trim();
  $("askBtn").disabled = !q;
  askTicket++;                  // invalidate any reply still in flight
  $("answer").innerHTML = "";   // an old answer must not outlive its question
  render();                     // render() sets the hint from what it decided
});
$("q").addEventListener("keydown", (e) => {
  // Guard on the button's own state: Enter would otherwise bypass it.
  if (e.key === "Enter" && !$("askBtn").disabled) ask();
});
$("askBtn").addEventListener("click", ask);

function setCategory(cat) {
  activeCat = cat;
  [...$("chips").children].forEach((c) =>
    c.setAttribute("aria-pressed", c.dataset.cat === cat));
}

$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  setCategory(b.dataset.cat);
  render();
});

$("list").addEventListener("click", (e) => {
  const b = e.target.closest(".add");
  if (!b) return;
  const found = cart.find(
    (c) => c.name === b.dataset.name && c.cat === b.dataset.cat);
  if (found) found.qty++;
  else cart.push({ name: b.dataset.name, cat: b.dataset.cat,
                   price: +b.dataset.price, qty: 1 });
  b.textContent = "Added ✓";
  setTimeout(() => (b.textContent = "Add to order"), 900);
  renderCart();
});

$("clear").addEventListener("click", () => { cart = []; renderCart(); });

boot();
