import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("server-only", () => ({}));
import { createGeminiStrategyProvider } from "../../src/features/campaign-strategist/gemini.server";
import { geminiConfiguration } from "../../src/lib/ai/gemini-json.server";

const config = { apiKey: "sk-cos-private-test-key", model: "deepseek-v4.1-flash", baseUrl: "https://api.cosmoshub.tech/v1", maxAttempts: 2 };
const prompt = { systemInstruction: "Trusted system rules", input: "Synthetic sanitized JSON" };
const completion = (content: string | null, finish = "stop", status = 200) =>
  new Response(JSON.stringify({ id: "chatcmpl-test", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }] }), { status });
const toolCall = (args: string) => new Response(JSON.stringify({ id: "chatcmpl-tool", choices: [{ index: 0, finish_reason: "tool_calls",
  message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "submit_json", arguments: args } }] } }] }));
const RequestSchema = z.object({ model: z.string(), max_tokens: z.number(),
  tools: z.array(z.object({ type: z.literal("function"), function: z.object({ name: z.string(), parameters: z.object({ type: z.literal("object"), properties: z.record(z.string(), z.unknown()) }) }) })),
  tool_choice: z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) }),
  messages: z.array(z.object({ role: z.string(), content: z.string() })) });
function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("OpenAI-compatible provider (CosmosHub)", () => {
  it("forces one function call whose parameters are the response schema and returns its arguments", async () => {
    const fetchMock = stubFetch(toolCall("{\"ok\":true}"));
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toEqual({ success: true, text: "{\"ok\":true}", model: config.model, requestId: "chatcmpl-tool" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cosmoshub.tech/v1/chat/completions");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${config.apiKey}`);
    const body = RequestSchema.parse(JSON.parse(String(init.body)));
    expect(body).toMatchObject({ model: "deepseek-v4.1-flash", max_tokens: 8_192, tool_choice: { function: { name: "submit_json" } } });
    expect(body.tools[0].function.name).toBe("submit_json");
    expect(body.tools[0].function.parameters.properties).toHaveProperty("contextHash");
    expect(body.messages[0]).toMatchObject({ role: "system", content: expect.stringContaining("Trusted system rules") });
    expect(body.messages[1]).toEqual({ role: "user", content: prompt.input });
  });

  it("still parses a model that answers in plain content, including a markdown fence", async () => {
    stubFetch(completion("```json\n{\"ok\":true}\n```"));
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toMatchObject({ success: true, text: "{\"ok\":true}" });
  });

  it("reports a length stop as truncated and a filtered answer as refused", async () => {
    stubFetch(completion("{\"options\":[", "length"), completion(null, "content_filter"));
    const provider = createGeminiStrategyProvider(config);
    expect(await provider.generate(prompt)).toEqual({ success: false, code: "OUTPUT_TRUNCATED" });
    expect(await provider.generate(prompt)).toEqual({ success: false, code: "PROVIDER_REFUSED" });
  });

  it("retries one explicit 429 and then succeeds", async () => {
    const fetchMock = stubFetch(new Response("{}", { status: 429 }), completion("{}"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a used-up balance (402) as configuration, without retrying or logging the key", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ error: { message: "insufficient balance" } }), { status: 402 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await createGeminiStrategyProvider(config).generate(prompt)).toEqual({ success: false, code: "CONFIGURATION_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(config.apiKey);
  });

  it("accepts non-Gemini model ids only together with an https base URL", () => {
    expect(geminiConfiguration({ GEMINI_API_KEY: "k", GEMINI_MODEL: "deepseek-v4.1-flash", GEMINI_BASE_URL: "https://api.cosmoshub.tech/v1" }))
      .toMatchObject({ model: "deepseek-v4.1-flash", baseUrl: "https://api.cosmoshub.tech/v1" });
    expect(() => geminiConfiguration({ GEMINI_API_KEY: "k", GEMINI_MODEL: "deepseek-v4.1-flash" })).toThrow();
    expect(() => geminiConfiguration({ GEMINI_API_KEY: "k", GEMINI_MODEL: "deepseek-v4.1-flash", GEMINI_BASE_URL: "http://api.cosmoshub.tech/v1" })).toThrow();
    expect(geminiConfiguration({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.6-flash" })).not.toHaveProperty("baseUrl");
  });
});
