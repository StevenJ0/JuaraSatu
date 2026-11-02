import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Use the already-declared TypeScript compiler and Node's built-in test runner.
// Pure modules are transpiled in memory; no framework, generated files or DB.
async function loadModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const input = await loadModule("../src/lib/input-validation.ts");
const errors = await loadModule("../src/lib/error-codes.ts");

function rejected(result) {
  assert.equal(result.success, false);
  assert.equal(result.issue.code, "VALIDATION_ERROR");
  assert.equal(typeof result.issue.message, "string");
  assert.equal("value" in result, false);
}

const noCoercion = ["12", "12abc", "12e3", "1.5", "", null, undefined, true, false, [], {}, 12n];
for (const name of ["validateQuantity", "validateMoneyIdr", "validatePositiveMoneyIdr", "validateDiscountBps"]) {
  for (const [i, value] of noCoercion.entries()) {
    test(`${name}: rejects non-number case ${i}`, () => rejected(input[name](value)));
  }
  for (const value of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    test(`${name}: rejects unsafe/fractional number ${String(value)}`, () => rejected(input[name](value)));
  }
}

for (const [name, values] of [
  ["validateQuantity", [1, 2, 10_000]],
  ["validateMoneyIdr", [0, 75_000, 108_000, 1_000_000_000]],
  ["validatePositiveMoneyIdr", [1, 108_000, 1_000_000_000]],
  ["validateDiscountBps", [0, 1_000, 9_999]],
]) {
  for (const value of values) test(`${name}: accepts ${value}`, () => {
    assert.deepEqual(input[name](value), { success: true, value });
  });
}
for (const [name, values] of [
  ["validateQuantity", [-1, 0, 10_001]],
  ["validateMoneyIdr", [-1, 1_000_000_001]],
  ["validatePositiveMoneyIdr", [-1, 0, 1_000_000_001]],
  ["validateDiscountBps", [-1, 10_000]],
]) {
  for (const value of values) test(`${name}: rejects out-of-range ${value}`, () => rejected(input[name](value)));
}

test("zero known cost differs from missing cost; final price must be positive", () => {
  assert.deepEqual(input.validateMoneyIdr(0), { success: true, value: 0 });
  rejected(input.validateMoneyIdr(null));
  rejected(input.validateMoneyIdr(undefined));
  rejected(input.validatePositiveMoneyIdr(0));
});

for (const [raw, expected] of [["  Ibu Sri  ", "Ibu Sri"], ["Nur 'Aisyah", "Nur 'Aisyah"], ["Rizki Éka", "Rizki Éka"], ["A".repeat(120), "A".repeat(120)], ["😀".repeat(120), "😀".repeat(120)]]) {
  test(`customer name accepts bounded plain text (${expected.length} UTF-16 units)`, () => {
    assert.deepEqual(input.validateCustomerName(raw), { success: true, value: expected });
  });
}
for (const [i, value] of ["", "   ", "A".repeat(121), "😀".repeat(121), null, undefined, 12, {}, []].entries()) {
  test(`customer name rejects invalid case ${i}`, () => rejected(input.validateCustomerName(value)));
}
for (const [i, char] of ["\n", "\r", "\t", "\0", "\u0085", "\u200b", "\u202e", "\u2028", "\u2029", "\ufeff"].entries()) {
  for (const name of ["validateCustomerName", "validateCustomerEmail"]) {
    test(`${name}: rejects control/format character ${i} before trimming`, () => {
      const result = input[name](`${char}buyer@example.com`);
      rejected(result);
      assert.equal(result.issue.reason, "unsafe_characters");
    });
  }
}

for (const [raw, expected] of [
  ["  Buyer.Demo+tag@example.com  ", "Buyer.Demo+tag@example.com"],
  ["buyer@xn--bcher-kva.example", "buyer@xn--bcher-kva.example"],
  ["o'neil@example.com", "o'neil@example.com"],
  ["buyer@localhost", "buyer@localhost"],
]) {
  test(`email accepts single-address HTML syntax: ${expected}`, () => {
    assert.deepEqual(input.validateCustomerEmail(raw), { success: true, value: expected });
  });
}
const maxEmail = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
assert.equal(maxEmail.length, 254);
test("email accepts 254 characters, rejects 255", () => {
  assert.deepEqual(input.validateCustomerEmail(maxEmail), { success: true, value: maxEmail });
  rejected(input.validateCustomerEmail(`${maxEmail}e`));
});
for (const [i, value] of ["", " ", null, undefined, 5, {}, "buyer", "@example.com", "buyer@", "buyer@@example.com", "buyer name@example.com", "buyer@example..com", "buyer@-example.com", "buyer@example-.com", "buyer@example_com", "buyer@example.com,other@example.com", "buyer@例え.example", `buyer@${"a".repeat(64)}.com`, "buyer@example.com\n"].entries()) {
  test(`email rejects invalid single-address case ${i}`, () => rejected(input.validateCustomerEmail(value)));
}

for (const value of ["kaos-november", "abc", "a".repeat(160), "kaos-2026"]) {
  test(`preorder slug accepts allowed shape length ${value.length}`, () => assert.deepEqual(input.validatePreorderSlug(value), { success: true, value }));
}
for (const [i, value] of ["", "ab", "a".repeat(161), "Kaos", " kaos", "kaos ", "kaos_name", "kaos/name", "kaos?paid=true", "kaos\n", "kaos\u200b", null, 123, {}].entries()) {
  test(`preorder slug rejects invalid case ${i}`, () => rejected(input.validatePreorderSlug(value)));
}

test("failures do not echo customer data into error metadata", () => {
  const sensitive = "Private Buyer\nprivate@example.com";
  const result = input.validateCustomerName(sensitive);
  rejected(result);
  assert.equal(JSON.stringify(result).includes("Private Buyer"), false);
  assert.equal(JSON.stringify(result).includes("private@example.com"), false);
});
test("unknown values are not coerced or executed", () => {
  const trap = { toString() { throw new Error("must not execute"); }, valueOf() { throw new Error("must not execute"); } };
  for (const name of ["validateCustomerName", "validateCustomerEmail", "validateQuantity", "validateMoneyIdr", "validatePositiveMoneyIdr", "validateDiscountBps", "validatePreorderSlug"]) rejected(input[name](trap));
});

test("catalogue exactly preserves the 17 PRD v2.1 application codes", () => {
  const expected = ["VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "PREORDER_NOT_OPEN", "CAPACITY_UNAVAILABLE", "OFFER_CHANGED", "BLUEPRINT_NOT_APPROVED", "CAMPAIGN_CONFLICT", "COSTS_INCOMPLETE", "PAYMENT_REVIEW_REQUIRED", "PROVIDER_UNAVAILABLE", "AI_INVALID_OUTPUT", "RETRIEVAL_UNAVAILABLE", "RATE_LIMITED"];
  assert.deepEqual(errors.APP_ERROR_CODES, expected);
  assert.equal(new Set(errors.APP_ERROR_CODES).size, 17);
  for (const code of expected) assert.equal(errors.isAppErrorCode(code), true);
  for (const code of ["paid", "validation_error", "UNKNOWN", null, {}, 1]) assert.equal(errors.isAppErrorCode(code), false);
  assert.equal(Object.isFrozen(errors.APP_ERROR_CODES), true);
});
