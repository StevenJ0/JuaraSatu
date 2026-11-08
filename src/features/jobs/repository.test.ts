import { createClient, PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { claimJobs, JOB_TYPES, JobRepositoryError } from "./repository";

const fixture = () => {
  const client = createClient("http://127.0.0.1:1", "test-only-key", { auth: { persistSession: false } });
  const rpc = vi.spyOn(client, "rpc").mockResolvedValue({ success: true, data: [], error: null, count: null, status: 200, statusText: "OK" });
  return { client, rpc };
};

describe("generic job claim boundary", () => {
  it("declares all three core types using the existing named RPC parameters", async () => {
    const { client, rpc } = fixture();
    await expect(claimJobs(client, JOB_TYPES, 5, 60)).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("claim_jobs", { p_job_types: JOB_TYPES, p_limit: 5, p_lease_seconds: 60 });
  });

  it("rejects empty, Memory and unknown input before RPC, including untyped external input", async () => {
    const { client, rpc } = fixture();
    for (const types of [[], ["embed_memory"], ["expire", "embed_memory"], ["unknown"], [null]]) {
      await expect(Reflect.apply(claimJobs, undefined, [client, types, 5, 60])).rejects.toThrow();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unexpected Memory claim response and preserves database error mapping", async () => {
    const { client, rpc } = fixture();
    rpc.mockResolvedValueOnce({ success: true, data: [{ id: "11111111-1111-4111-8111-111111111111", job_type: "embed_memory", entity_id: null, business_id: null, attempt_count: 1 }], error: null, count: null, status: 200, statusText: "OK" });
    await expect(claimJobs(client, ["expire"], 5, 60)).rejects.toThrow();
    rpc.mockResolvedValueOnce({ success: false, data: null, error: new PostgrestError({ code: "P0001", message: "VALIDATION_ERROR", details: "", hint: "" }), count: null, status: 400, statusText: "Bad Request" });
    await expect(claimJobs(client, ["expire"], 5, 60)).rejects.toBeInstanceOf(JobRepositoryError);
  });
});
