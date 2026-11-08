import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { findPreorder, findPreorderContext, findPublicPreorder } from "@/features/preorders/repository";

const caseSchema = z.object({ row: z.unknown(), offer: z.unknown(), id: z.string(), businessId: z.string(), slug: z.string(),
  price: z.number(), pickup: z.string(), contact: z.string().nullable() });
const fixturePath = process.env.A3_PUBLICATION_FIXTURE;
const fixtures = fixturePath ? z.object({ before: caseSchema, after: z.array(caseSchema).min(3) })
  .parse(JSON.parse(readFileSync(fixturePath, "utf8"))) : null;

function clientFor(f: z.infer<typeof caseSchema>) {
  // Actual SQL rows enter the real repository parsers; every HTTP request is intercepted locally.
  return createClient("http://127.0.0.1:1", "a3-test-only", { auth: { persistSession: false }, global: {
    fetch: async input => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const data = url.pathname === "/rest/v1/preorders" ? f.row
        : url.pathname === "/rest/v1/rpc/read_preorder_offer" ? f.offer : undefined;
      if (data === undefined) throw Error(`Unexpected offline parser request: ${url.pathname}`);
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    },
  } });
}

describe.skipIf(!fixtures)("A3 actual PostgreSQL publication rows through core readers", () => {
  it("reproduces rejection of the original legacy snapshot by all three actual readers", async () => {
    if (!fixtures) throw Error("Missing isolated SQL evidence");
    const f = fixtures.before, client = clientFor(f);
    await expect(findPreorder(client, f.businessId, f.id)).rejects.toBeInstanceOf(z.ZodError);
    await expect(findPreorderContext(client, f.businessId, f.id)).rejects.toBeInstanceOf(z.ZodError);
    await expect(findPublicPreorder(client, f.slug)).rejects.toBeInstanceOf(z.ZodError);
  });

  it.each(fixtures?.after ?? [])("accepts canonical published SQL row $id through owner/public/context readers", async f => {
    const client = clientFor(f);
    await expect(findPreorder(client, f.businessId, f.id)).resolves.toMatchObject({ status: "published", basePriceIdr: f.price,
      frozenTerms: { pickupInstructions: f.pickup, publicContact: f.contact } });
    await expect(findPublicPreorder(client, f.slug)).resolves.toMatchObject({ basePriceIdr: f.price, unitPriceIdr: f.price,
      pickup: { instructions: f.pickup, publicContact: f.contact } });
    await expect(findPreorderContext(client, f.businessId, f.id)).resolves.toMatchObject({ product: { basePriceIdr: f.price }, preorder: { id: f.id, status: "published" } });
  });
});
