/**
 * Build the menu from the catalogue spreadsheet.
 *
 *   node tools/build_menu.mjs
 *
 * Reads tools/catalogue.xlsx (the file you export from WhatsApp Business
 * / Vyapar and drop into the repo) and writes the two generated files:
 *
 *   public/menu.json   the menu the browser ships with
 *   src/menu.js        the same menu, as a module the Worker imports
 *
 * This runs at DEPLOY TIME on Cloudflare, so it is deliberately pure
 * Node with a single dependency (the `xlsx` reader). No Python, no CSV
 * middle step: you upload the .xlsx, Cloudflare rebuilds, the site shows
 * whatever is in that sheet.
 *
 * Column headers are matched loosely, so these all work:
 *   Collection / Category           -> category
 *   Item Name / Item / Name / Product
 *   Price (PKR) / Price / Rate / Amount
 *   Description / Desc / Details
 * plus optional explicit macro columns (carbs, fat, protein, kcal,
 * serving, image) if a future sheet ever has them.
 *
 * Macros: your descriptions currently carry the macros inline, e.g.
 *   "...; macros per square: Fat 19.5g, Protein 3.1g, Carbs 2.3g, Energy 198kcal"
 * The script lifts those into a proper macro strip AND keeps the full
 * description text (so search still sees every word). If a row has no
 * inline macros and no macro columns, it simply shows no strip.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_PATH = join(ROOT, "tools", "catalogue.xlsx");
const CSV_PATH = join(ROOT, "tools", "catalogue.csv"); // legacy fallback
const OUT_JSON = join(ROOT, "public", "menu.json");
const OUT_WORKER = join(ROOT, "src", "menu.js");

/* ---------- header matching ----------
   Sheets from different exports label columns differently. Match on a
   normalised header (lowercased, symbols stripped) against a list of
   aliases, so "Price (PKR)", "price", and "Rate" all land on price.  */
const FIELD_ALIASES = {
  category: ["collection", "category", "cat", "section", "type"],
  item: ["itemname", "item", "name", "product", "productname", "title"],
  price: ["pricepkr", "price", "rate", "amount", "cost", "pricers"],
  description: ["description", "desc", "details", "detail", "about"],
  // Optional explicit columns — only used if the sheet actually has them.
  carbs: ["carbs", "carb", "carbohydrates"],
  fat: ["fat", "fats"],
  protein: ["protein", "proteins"],
  kcal: ["kcal", "energy", "calories", "cal"],
  serving: ["serving", "servingsize", "per", "portion"],
  image: ["image", "img", "photo", "picture"],
};

function normHeader(h) {
  return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map the sheet's actual headers onto our canonical field names. */
function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((raw, idx) => {
    const key = normHeader(raw);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key) && !(field in map)) map[field] = idx;
    }
  });
  return map;
}

/* ---------- text cleanup ----------
   The uncle's sheet uses non-breaking hyphens (U+2011) and en/em dashes
   in places ("gluten‑free", "ice‑cream"). Normalise them to plain ASCII
   so search and display are predictable, and collapse whitespace.     */
function clean(text) {
  return String(text ?? "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, "-") // hyphen/dash variants
    .replace(/[\u2018\u2019]/g, "'")                    // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')                    // curly double quotes
    .replace(/\u00A0/g, " ")                            // non-breaking space
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- description sanitising ----------
   The WhatsApp catalogue export carries two things a customer should not
   see verbatim:

   1. A leading "Hidden item; " marker — an internal flag from the
      catalogue, not part of the product's description.
   2. A trailing "macros per ...: Fat .. Protein .." clause. Once those
      figures are lifted into a clean macro strip, repeating them as
      prose is redundant. Removing the tail also drops "macros not
      provided" notes, which read oddly to a customer.

   Both are stripped conservatively: only the recognised marker/clause is
   removed, the rest of the description is left exactly as written. This
   runs AFTER macro parsing, so the figures are already captured.       */
function tidyDescription(desc) {
  let text = String(desc || "");
  // Drop a leading "Hidden item" flag in any punctuation form.
  text = text.replace(/^\s*hidden\s+item\s*[;:.\-]*\s*/i, "");
  // Drop a trailing macros clause: from the word "macros" (or a bare
  // "per <unit>: Fat ...") to the end of the string.
  text = text.replace(/[;.,]?\s*macros\b[^]*$/i, "");
  text = text.replace(/[;.,]?\s*per\s+[a-z]+[^:]*:\s*(?:fat|protein|carbs?|energy)\b[^]*$/i, "");
  return clean(text).replace(/[;,\s]+$/, "");
}

function num(value) {
  if (value === null || value === undefined) return null;
  // Pull out the first number, e.g. "Rs 2,200" -> 2200. Deliberately a
  // match, not a strip-and-join: stripping every non-digit character
  // (the previous approach) turns a price range like "1000-1200" into
  // "10001200" by silently deleting the hyphen between two valid
  // numbers, rather than either rejecting it or picking one side. This
  // takes the first number in the cell, so "1000-1200" reads as 1000 and
  // "Rs 2,200" still reads as 2200.
  const m = String(value).match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* ---------- inline macro extraction ----------
   Descriptions carry macros as free text, e.g.
     "...; macros per square: Fat 19.5g, Protein 3.1g, Carbs 2.3g, Energy 198kcal"
   Pull each figure out by name. Missing ones are simply left out. The
   description text itself is NOT stripped — search still sees it.      */
function parseMacros(desc) {
  const text = String(desc || "");
  const grab = (labels) => {
    const pattern = new RegExp(
      `(?:${labels.join("|")})\\s*[:=]?\\s*([0-9]+(?:\\.[0-9]+)?)`,
      "i"
    );
    const m = text.match(pattern);
    return m ? Number(m[1]) : null;
  };

  const macros = {
    carbs: grab(["carbs", "carbohydrates", "carb"]),
    fat: grab(["fat"]),
    protein: grab(["protein"]),
    kcal: grab(["energy", "kcal", "calories"]),
  };

  // "macros per square", "macros per tbsp 15g", "per piece"
  const servingMatch = text.match(
    /(?:macros\s+)?per\s+([a-z]+(?:\s*\d+\s*(?:g|gm|ml)?)?)/i
  );
  const serving = servingMatch ? clean(servingMatch[1]) : "";

  const has = Object.values(macros).some((v) => v !== null);
  if (!has) return { macros: null, serving: "" };

  const kept = {};
  for (const k of ["carbs", "fat", "protein", "kcal"]) {
    if (macros[k] !== null) kept[k] = macros[k];
  }
  return { macros: kept, serving };
}

/* ---------- read the source spreadsheet ---------- */
function readRows() {
  if (existsSync(XLSX_PATH)) {
    const wb = XLSX.read(readFileSync(XLSX_PATH), { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // header:1 gives raw rows so we can match headers ourselves.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    return { rows, source: XLSX_PATH };
  }
  if (existsSync(CSV_PATH)) {
    // Fallback: a plain CSV still works if no xlsx is present.
    const wb = XLSX.read(readFileSync(CSV_PATH, "utf8"), { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    return { rows, source: CSV_PATH };
  }
  return { rows: null, source: null };
}

function main() {
  const { rows, source } = readRows();
  if (!rows) {
    console.error(
      `ERROR: no catalogue found. Put tools/catalogue.xlsx (preferred) ` +
        `or tools/catalogue.csv in the repo.`
    );
    process.exit(1);
  }
  if (rows.length < 2) {
    console.error(`ERROR: ${relative(ROOT, source)} has no data rows.`);
    process.exit(1);
  }

  const headerMap = buildHeaderMap(rows[0]);
  for (const required of ["item", "price"]) {
    if (!(required in headerMap)) {
      console.error(
        `ERROR: could not find a "${required}" column. ` +
          `Found headers: ${rows[0].join(", ")}`
      );
      process.exit(1);
    }
  }

  const cell = (row, field) =>
    field in headerMap ? row[headerMap[field]] : undefined;

  const items = [];
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const name = clean(cell(row, "item"));
    const price = num(cell(row, "price"));
    if (!name || price === null) {
      skipped++;
      continue;
    }

    const rawDesc = clean(cell(row, "description"));
    const entry = {
      cat: clean(cell(row, "category")) || "Other",
      name,
      desc: rawDesc, // replaced below once macros are parsed from it
      price: Math.round(price),
    };

    // Prefer explicit macro columns if the sheet has them; otherwise
    // fall back to parsing them out of the description text.
    const explicit = {
      carbs: num(cell(row, "carbs")),
      fat: num(cell(row, "fat")),
      protein: num(cell(row, "protein")),
      kcal: num(cell(row, "kcal")),
    };
    const hasExplicit = Object.values(explicit).some((v) => v !== null);

    if (hasExplicit) {
      const kept = {};
      for (const k of ["carbs", "fat", "protein", "kcal"]) {
        if (explicit[k] !== null) kept[k] = explicit[k];
      }
      entry.macros = kept;
      const serving = clean(cell(row, "serving"));
      if (serving) entry.serving = serving;
    } else {
      const { macros, serving } = parseMacros(rawDesc);
      if (macros) {
        entry.macros = macros;
        if (serving) entry.serving = serving;
      }
    }

    // Now that any inline macros are captured, clean the customer-facing
    // description: drop the "Hidden item" flag and the redundant macro
    // tail. Done last so parsing above still sees the original text.
    entry.desc = tidyDescription(rawDesc);

    const image = clean(cell(row, "image"));
    if (image) entry.image = image;

    items.push(entry);
  }

  mkdirSync(dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(items, null, 1), "utf8");
  writeFileSync(
    OUT_WORKER,
    "// Generated by tools/build_menu.mjs. Do not edit by hand.\n" +
      "export default " +
      JSON.stringify(items, null, 1) +
      ";\n",
    "utf8"
  );

  const cats = [];
  for (const it of items) if (!cats.includes(it.cat)) cats.push(it.cat);
  const sizeKb = Buffer.byteLength(readFileSync(OUT_JSON)) / 1024;
  const noDesc = items.filter((i) => !i.desc).length;
  const noMacros = items.filter((i) => !i.macros).length;

  console.log(`Read   ${relative(ROOT, source)}`);
  console.log(`Wrote  ${relative(ROOT, OUT_JSON)}`);
  console.log(`Wrote  ${relative(ROOT, OUT_WORKER)}`);
  console.log(
    `  ${items.length} items across ${cats.length} categories (${sizeKb.toFixed(1)} KB)`
  );
  if (skipped) console.log(`  skipped ${skipped} row(s) with no name or price`);
  if (noDesc) console.log(`  ${noDesc} item(s) have no description`);
  if (noMacros) console.log(`  ${noMacros} item(s) have no macros (no strip shown)`);
}

main();
