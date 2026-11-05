import { describe, expect, it, vi } from "vitest";
import { createScreenshotReader, ScreenshotReadError } from "./screenshot-reader.js";

const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
const noSleep = async () => {};

const answer = (value: unknown, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status });

const receipt = {
  is_telebirr_receipt: true,
  successful: true,
  transaction_number: "ABC123XYZ9",
  transaction_to: "Kibrom",
  transaction_time: "2026/10/31 11:04:01",
  amount: 101,
};

describe("createScreenshotReader", () => {
  it("sends the image with the key in a header, not the URL, and reads the answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => answer(receipt));
    const reader = createScreenshotReader({ apiKey: "secret", fetch, sleep: noSleep });

    await expect(reader(image)).resolves.toEqual({
      isTelebirrReceipt: true,
      successful: true,
      transactionNumber: "ABC123XYZ9",
      transactionTo: "Kibrom",
      transactionTime: "2026/10/31 11:04:01",
      amount: 101,
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).not.toContain("secret");
    expect((init!.headers as Record<string, string>)["X-goog-api-key"]).toBe("secret");
    expect(JSON.parse(String(init!.body)).contents[0].parts[1].inlineData).toEqual({
      mimeType: "image/jpeg",
      data: "AQID",
    });
  });

  it("drops a minus sign and treats blank values as missing", async () => {
    const reader = createScreenshotReader({
      apiKey: "k",
      fetch: async () => answer({ ...receipt, amount: -102.01, transaction_to: "  " }),
      sleep: noSleep,
    });

    await expect(reader(image)).resolves.toMatchObject({ amount: 102.01, transactionTo: null });
  });

  it("retries a failure, then succeeds", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(answer({}, 503))
      .mockResolvedValueOnce(answer(receipt));
    const reader = createScreenshotReader({ apiKey: "k", fetch, sleep: noSleep });

    await expect(reader(image)).resolves.toMatchObject({ transactionNumber: "ABC123XYZ9" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the other model on the last try", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(answer({}, 503))
      .mockResolvedValueOnce(answer({}, 503))
      .mockResolvedValueOnce(answer(receipt));
    const reader = createScreenshotReader({ apiKey: "k", models: ["main", "spare"], fetch, sleep: noSleep });

    await expect(reader(image)).resolves.toMatchObject({ transactionNumber: "ABC123XYZ9" });
    expect(fetch.mock.calls.map(([url]) => String(url).match(/models\/(\w+):/)?.[1])).toEqual([
      "main",
      "main",
      "spare",
    ]);
  });

  it.each([
    ["a server error", async () => answer({}, 500)],
    ["a network failure", async () => Promise.reject(new Error("down"))],
    ["an empty answer", async () => new Response(JSON.stringify({ candidates: [] }))],
    [
      "an answer that isn't JSON",
      async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })),
    ],
    ["an answer missing fields", async () => answer({ amount: 1 })],
  ])("reports %s as a read error after three tries", async (_name, fetchImpl) => {
    const fetch = vi.fn<typeof globalThis.fetch>(fetchImpl);
    const reader = createScreenshotReader({ apiKey: "k", fetch, sleep: noSleep });

    await expect(reader(image)).rejects.toBeInstanceOf(ScreenshotReadError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("doesn't put the key in the error", async () => {
    const reader = createScreenshotReader({ apiKey: "secret", fetch: async () => answer({}, 403), sleep: noSleep });

    await expect(reader(image)).rejects.not.toThrow("secret");
  });
});
