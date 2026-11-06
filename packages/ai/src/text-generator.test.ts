import { describe, expect, it, vi } from "vitest";
import { createTextGenerator } from "./text-generator.js";

const answer = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const noSleep = async () => {};

describe("createTextGenerator", () => {
  it("sends the system and user text, with the key in a header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => answer("What a week!"));
    const generate = createTextGenerator({ apiKey: "secret", fetch, sleep: noSleep });

    await expect(generate("be funny", "GW10 facts")).resolves.toBe("What a week!");
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).not.toContain("secret");
    const body = JSON.parse(String(init!.body));
    expect(body.systemInstruction.parts[0].text).toBe("be funny");
    expect(body.contents[0].parts[0].text).toBe("GW10 facts");
  });

  it("falls back to the next model", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(answer("Saved by the spare"));
    const generate = createTextGenerator({ apiKey: "k", models: ["main", "spare"], fetch, sleep: noSleep });

    await expect(generate("s", "p")).resolves.toBe("Saved by the spare");
    expect(String(fetch.mock.calls[1]![0])).toContain("spare");
  });

  it("fails when every model fails, or gives nothing", async () => {
    const down = createTextGenerator({
      apiKey: "k",
      fetch: async () => new Response("{}", { status: 500 }),
      sleep: noSleep,
    });
    await expect(down("s", "p")).rejects.toThrow("Couldn't write text");

    const empty = createTextGenerator({ apiKey: "k", fetch: async () => new Response("{}"), sleep: noSleep });
    await expect(empty("s", "p")).rejects.toThrow("Couldn't write text");
  });
});
