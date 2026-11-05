// Prints what Gemini reads from real screenshots. Uses the live API, so it isn't part of the tests.
// Usage: pnpm --filter @potbot/ai check-screenshots <image files, absolute paths>
import { readFileSync } from "node:fs";
import { createScreenshotReader } from "../src/index.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY in .env first.");

const read = createScreenshotReader({ apiKey });
for (const file of process.argv.slice(2)) {
  const mimeType = file.endsWith(".png") ? "image/png" : "image/jpeg";
  const reading = await read({ bytes: readFileSync(file), mimeType });
  console.log(file.split("/").pop(), JSON.stringify(reading));
}
