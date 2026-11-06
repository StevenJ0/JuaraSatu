import { GoogleGenAI } from "@google/genai";

if (!process.argv.includes("--allow-paid-generation")) {
  console.error("OPT_IN_REQUIRED: --allow-paid-generation; this script sends one billable Gemini request");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY || !/^gemini-[a-zA-Z0-9.-]+$/.test(process.env.GEMINI_MODEL ?? "") || /embedding/i.test(process.env.GEMINI_MODEL)) {
  console.error("CONFIGURATION_ERROR: explicit text GEMINI_MODEL and server GEMINI_API_KEY required");
  process.exit(1);
}
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  const response = await ai.interactions.create({
    model: process.env.GEMINI_MODEL,
    store: false,
    generation_config: { max_output_tokens: 256 },
    input:
      "Berikan satu ide promosi sederhana untuk UMKM brownies dalam satu kalimat.",
  }, { timeout_ms: 60000, retries: { strategy: "none" } });

  console.log(response.output_text);
}

main().catch((error) => {
  console.error("Gemini request failed", { httpStatus: typeof error?.status === "number" ? error.status : null });
  process.exitCode = 1;
});
