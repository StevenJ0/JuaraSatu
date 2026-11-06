# NOT EXPOSED VIA HTTP

C2 and compareScenarios are pure TypeScript. No invented pricing/simulator requests.

- Preview: http://localhost:3100/dev/campaign-simulator
- Unit: npm.cmd run test:unit (tests/unit/pricing.test.ts, campaign-simulator.test.ts)
- Browser: node tests/browser/campaign-simulator-comparison.mjs

Normal/discount, independent units/spending, capacity, unknown costs, rounding and non-stacking are covered there. HTTP strategies/blueprints indirectly reuse C2; Bruno cannot invoke unexposed functions.
