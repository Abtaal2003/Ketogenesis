/**
 * Verifies what askGemini actually puts on the wire.
 *
 * Nothing here talks to Google. globalThis.fetch is replaced with a stub
 * that captures the request the Worker builds, so we can assert on the
 * exact JSON body without a key, a network call, or any quota.
 *
 * Run: node tools/test_thinking.mjs
 */

import worker from "../src/index.js";

let captured = null;
let nextResponse = null;

globalThis.fetch = async (url, init) => {
  captured = { url, init, body: JSON.parse(init.body) };
  return nextResponse();
};

const geminiOk = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: "Yes, almond flour is in stock." }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { thoughtsTokenCount: 0, candidatesTokenCount: 9 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const geminiError = () =>
  new Response(JSON.stringify({ error: { message: "bad request" } }), {
    status: 400,
  });

function ask(env) {
  return worker.fetch(
    new Request("https://ketogenesis.example.com/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://ketogenesis.example.com",
      },
      body: JSON.stringify({ q: "almond flour hai?" }),
    }),
    env
  );
}

const BASE = {
  LLM_PROVIDER: "gemini",
  GEMINI_API_KEY: "test-key",
  GEMINI_MODEL: "gemini-3.5-flash",
};

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

/* ---- 1. default: no var set, code default applies ---- */
console.log("\n1. Default thinking level (no GEMINI_THINKING_LEVEL var)");
nextResponse = geminiOk;
let res = await ask(BASE);
let json = await res.json();
let gc = captured.body.generationConfig;

check("request goes to the v1beta generateContent endpoint",
  captured.url ===
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
  captured.url);
check("thinkingConfig sits inside generationConfig",
  gc.thinkingConfig !== undefined,
  JSON.stringify(gc));
check('thinkingLevel is the lowercase string "low"',
  gc.thinkingConfig.thinkingLevel === "low",
  JSON.stringify(gc.thinkingConfig));
check("thinkingBudget is NOT sent alongside it",
  gc.thinkingConfig.thinkingBudget === undefined);
check("maxOutputTokens left at 2000",
  gc.maxOutputTokens === 2000, String(gc.maxOutputTokens));
check("temperature untouched",
  gc.temperature === 0.3, String(gc.temperature));
check("system_instruction and contents still present",
  !!captured.body.system_instruction && Array.isArray(captured.body.contents));
check("answer flows back to the caller",
  json.answer === "Yes, almond flour is in stock.", JSON.stringify(json.answer));
check("items still returned alongside the answer",
  Array.isArray(json.items) && json.items.length > 0,
  `items=${json.items?.length}`);

/* ---- 2. var override ---- */
console.log("\n2. Override via GEMINI_THINKING_LEVEL");
nextResponse = geminiOk;
await ask({ ...BASE, GEMINI_THINKING_LEVEL: "minimal" });
check('var wins over the code default',
  captured.body.generationConfig.thinkingConfig.thinkingLevel === "minimal",
  JSON.stringify(captured.body.generationConfig.thinkingConfig));

nextResponse = geminiOk;
await ask({ ...BASE, GEMINI_THINKING_LEVEL: "  HIGH  " });
check('messy var value is trimmed and lowercased',
  captured.body.generationConfig.thinkingConfig.thinkingLevel === "high",
  JSON.stringify(captured.body.generationConfig.thinkingConfig));

/* ---- 3. the Cerebras path must be untouched ---- */
console.log("\n3. Cerebras path unchanged");
nextResponse = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: {},
    }),
    { status: 200 }
  );
await ask({ LLM_PROVIDER: "cerebras", CEREBRAS_API_KEY: "k" });
check("still hits Cerebras",
  captured.url === "https://api.cerebras.ai/v1/chat/completions", captured.url);
check("no thinkingConfig leaked into the Cerebras body",
  captured.body.thinkingConfig === undefined &&
    captured.body.generationConfig === undefined);
check("reasoning_effort still low",
  captured.body.reasoning_effort === "low");

/* ---- 4. graceful degradation still works ---- */
console.log("\n4. Failure still degrades to the item list");
nextResponse = geminiError;
res = await ask(BASE);
json = await res.json();
check("HTTP 200 to the browser even when Gemini errors", res.status === 200);
check("answer is null, items still served",
  json.answer === null && Array.isArray(json.items) && json.items.length > 0);

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
