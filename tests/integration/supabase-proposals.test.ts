import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StrategyProposalSchema } from "../../src/features/campaign-strategist/contracts";

describe("actual local Supabase proposal persistence", () => {
  it("reloads the active synthetic fixture using the existing runtime contract", () => {
    const text = execFileSync("docker", ["exec", "supabase_db_campaign-lab", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
      `SELECT coalesce(json_agg(g.output_json),'[]'::json) FROM public.ai_generations g
       JOIN public.campaign_ai_sessions s ON s.id=g.session_id
       WHERE g.model_id='synthetic-database-test' AND g.status='success' AND s.status='active';`],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const value: unknown = JSON.parse(text);
    const proposals = z.array(z.unknown()).parse(value);
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) expect(StrategyProposalSchema.safeParse(proposal).success).toBe(true);
  });
});
