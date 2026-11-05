import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimJobs, completeJob, enqueueExpireJobs, failJob, type ClaimedJob } from "@/features/jobs/repository";
import { runExpireJobs } from "@/features/jobs/service";
import { expireOrder } from "@/features/orders/service";

vi.mock("@/features/jobs/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/jobs/repository")>();
  return { ...original, claimJobs: vi.fn(), completeJob: vi.fn(), enqueueExpireJobs: vi.fn(), failJob: vi.fn() };
});
vi.mock("@/features/orders/service", () => ({ expireOrder: vi.fn() }));

const claim = vi.mocked(claimJobs);
const complete = vi.mocked(completeJob);
const enqueue = vi.mocked(enqueueExpireJobs);
const failed = vi.mocked(failJob);
const expire = vi.mocked(expireOrder);

// Repository di-mock sehingga client tidak pernah dipakai.
const client = {} as SupabaseClient;
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({ id: "22222222-2222-4222-8222-222222222222", type: "expire", entityId: ORDER_ID, businessId: null, attempt: 1, ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  enqueue.mockResolvedValue(1);
  complete.mockResolvedValue(true);
  failed.mockResolvedValue("retryable_failed");
});

describe("runExpireJobs", () => {
  it("merapikan pesanan lalu menyelesaikan job", async () => {
    claim.mockResolvedValue([job()]);
    expire.mockResolvedValue({ kind: "ok", value: undefined });

    await expect(runExpireJobs(client)).resolves.toEqual({ enqueued: 1, expired: 1, skipped: 0, failed: 0 });

    expect(expire).toHaveBeenCalledWith(client, ORDER_ID, null);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("pesanan yang sudah lunas tidak diulang terus", async () => {
    claim.mockResolvedValue([job()]);
    expire.mockResolvedValue({ kind: "rejected", violation: "ORDER_STATE_INVALID" });

    await expect(runExpireJobs(client)).resolves.toMatchObject({ expired: 0, skipped: 1, failed: 0 });

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("kegagalan database masuk ulang terbatas dengan kode saja", async () => {
    claim.mockResolvedValue([job()]);
    expire.mockRejectedValue(new Error("rahasia dari database"));

    await expect(runExpireJobs(client)).resolves.toMatchObject({ failed: 1 });

    expect(failed).toHaveBeenCalledWith(client, expect.objectContaining({ attempt: 1 }), "EXPIRE_FAILED");
    expect(complete).not.toHaveBeenCalled();
  });

  it("job tanpa pesanan gagal tanpa memanggil apa pun", async () => {
    claim.mockResolvedValue([job({ entityId: null })]);

    await expect(runExpireJobs(client)).resolves.toMatchObject({ failed: 1 });

    expect(expire).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(client, expect.anything(), "ENTITY_MISSING");
  });

  it("satu job gagal tidak menghentikan job lain", async () => {
    claim.mockResolvedValue([job(), job({ id: "33333333-3333-4333-8333-333333333333" })]);
    expire.mockRejectedValueOnce(new Error("gagal")).mockResolvedValueOnce({ kind: "ok", value: undefined });

    await expect(runExpireJobs(client)).resolves.toMatchObject({ expired: 1, failed: 1 });
  });
});
