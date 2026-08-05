#!/usr/bin/env node
/**
 * Retrieval quality eval for the context engine. Turns "it's good" into a number.
 * For a set of (query → expected symbol/file) pairs, runs retrieve_context and
 * measures hit@k (was the expected chunk in the top-k) and MRR (mean reciprocal rank).
 *
 * Run against any indexed framework:  FRAMEWORK_ROOT=/path node test/eval-retrieval.mjs
 * Needs the embedding model loaded (semantic_search / retrieve_context use it).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieveContext } from "../dist/context.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FRAMEWORK_ROOT || path.resolve(HERE, "../../playwright-pom-framework");
const K = Number(process.env.EVAL_K || 6);

// Gold set for the bundled sample. `expect` matches against each hit's "file › symbol".
const GOLD = [
  { q: "how do we log in the standard user", expect: /LoginPage\.login|login\.spec/i },
  { q: "where are cart items counted", expect: /CartPage\.itemCount|InventoryPage\.cartCount/i },
  { q: "how do we add a product to the cart", expect: /InventoryPage\.addToCart/i },
  { q: "remove an item from the cart", expect: /removeFromCart|remove-item/i },
  { q: "sort the products by price", expect: /sortBy|sort/i },
  { q: "fill in the checkout information form", expect: /CheckoutPage\.fillInformation/i },
  { q: "how is the order total verified", expect: /totalText|summaryTotal|checkout/i },
  { q: "what tags can a test use", expect: /@(smoke|functional|negative|e2e)|login\.spec|catalog/i },
];

let hits = 0;
let rrSum = 0;
const rows = [];
for (const { q, expect } of GOLD) {
  const pack = await retrieveContext(ROOT, q, { tokenBudget: 2500 });
  const labels = pack.items.map((it) => `${it.file} › ${it.symbol}`);
  const rank = labels.findIndex((l) => expect.test(l)) + 1; // 1-based, 0 = miss
  const hit = rank > 0 && rank <= K;
  if (hit) { hits++; rrSum += 1 / rank; }
  rows.push({ q, rank: rank || "—", top: labels[0] || "(none)" });
}

const n = GOLD.length;
console.log(`\nRetrieval eval on ${path.basename(ROOT)}  (k=${K}, ${n} queries)\n`);
for (const r of rows) console.log(`  ${String(r.rank).padStart(2)}  ${r.q}\n      → ${r.top}`);
console.log(`\n  hit@${K}: ${hits}/${n} = ${(100 * hits / n).toFixed(0)}%`);
console.log(`  MRR:    ${(rrSum / n).toFixed(3)}\n`);
process.exit(hits === n ? 0 : 1);
