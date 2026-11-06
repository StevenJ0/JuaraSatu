import assert from "node:assert/strict";

export function verifySchemaColumns(schemaText, columns) {
  const expected = new Map(); let table; let reading = false;
  for (const line of schemaText.split(/\r?\n/)) {
    const heading = line.match(/^## \d+\.\d+ `([a-z_]+)`/);
    if (heading) { table = heading[1]; reading = false; }
    if (line.startsWith("| Column | Type |")) { reading = true; expected.set(table, []); continue; }
    if (reading && !line.startsWith("|")) { reading = false; continue; }
    if (reading && !line.startsWith("|---")) expected.get(table).push(line.split("|").slice(1, -1).map((field) => field.trim()));
  }
  assert.equal(expected.size, 26, "Expected the complete current schema contract");
  const actual = new Map(columns.map((column) => [`${column.table}.${column.column}`, column]));
  const defaults = { "now()": "now()", "1": "1", "0": "0", "false": "false", "true": "true",
    owner: "'owner'::text", "Asia/Jakarta": "'Asia/Jakarta'::character varying" };
  const result = [];
  for (const [table, fields] of expected) {
    for (const [name, type, rules] of fields) {
      const key = `${table}.${name}`; const column = actual.get(key); actual.delete(key);
      if (!column) { result.push({ name: key, classification: "MISSING" }); continue; }
      const draftSlug = ["preorders.slug", "campaigns.slug"].includes(key);
      const expectedNullable = rules.includes("NULLABLE") || draftSlug;
      const actualType = column.type.replace(/^extensions\./, "").replace("character varying", "varchar").replace("timestamp with time zone", "timestamptz");
      const differences = [];
      if (actualType !== type) differences.push(`type: expected ${type}, got ${actualType}`);
      if (column.nullable !== expectedNullable) differences.push(`nullable: expected ${expectedNullable}`);
      const defaultToken = rules.match(/DEFAULT (\S+)/)?.[1];
      if (defaultToken) {
        assert.ok(defaultToken in defaults, `Unsupported documented default: ${defaultToken}`);
        if (column.default !== defaults[defaultToken]) differences.push(`default: expected ${defaults[defaultToken]}, got ${column.default}`);
      }
      if (name === "id" && rules.includes("PK") && column.default !== "gen_random_uuid()") differences.push("UUID primary key default missing");
      result.push({ name: key, classification: differences.length ? "MISMATCH" : "MATCH", ...(differences.length ? { differences } : {}) });
    }
  }
  for (const name of actual.keys()) result.push({ name, classification: "EXTRA" });
  return result;
}
