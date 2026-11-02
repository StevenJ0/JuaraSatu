/** Golden assertions for presentation data, not proof of production pricing/DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/marketing/demo-data.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const fixture = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const expected = {
  initialAvailable: 8,
  initialTargetGap: 10,
  campaignStartAvailable: 10,
  unitDiscount: 12_000,
  offerPrice: 108_000,
  unitContribution: 33_000,
  finalPaidUnits: 38,
  finalFulfilledUnits: 38,
  finalAvailable: 2,
  finalTargetGap: 2,
  campaignUnattributedUnits: 3,
  campaignRevenue: 864_000,
  campaignProductionCost: 600_000,
  campaignContribution: 214_000,
  preorderRevenue: 4_464_000,
  preorderProductionCost: 2_850_000,
  preorderContribution: 1_564_000,
  goalCompletion: 0.95,
  completionLabel: "95%",
};
for (const [key, value] of Object.entries(expected)) {
  assert.equal(fixture[key], value, `PRD v2.1 golden value: ${key}`);
}
assert.equal(fixture.demo.campaignPaidUnits, fixture.demo.campaignAttributedUnits + fixture.campaignUnattributedUnits, "Attribution is a partition, not additional orders");
assert.equal(fixture.demo.campaignDiscountedUnits, fixture.demo.campaignPaidUnits, "Discount also applies to organic buyers in this scenario");
assert.equal(fixture.rupiah(fixture.preorderContribution), "Rp1.564.000", "Indonesian currency display");
console.log("PASS: 22 landing golden assertions (synthetic presentation data only).");
