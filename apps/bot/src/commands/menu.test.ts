import { describe, expect, it, vi } from "vitest";
import { syncCommands } from "./menu.js";

describe("syncCommands", () => {
  const run = async () => {
    const setMyCommands = vi.fn(async () => true);
    await syncCommands({ setMyCommands });
    return setMyCommands.mock.calls as unknown as [
      { command: string; description: string }[],
      { scope: { type: string } },
    ][];
  };

  it("gives members their commands, and group admins the manager ones too", async () => {
    const calls = await run();
    const names = (type: string) =>
      calls.find(([, other]) => other.scope.type === type)?.[0].map((item) => item.command) ?? [];

    expect(names("all_private_chats")).toEqual(expect.arrayContaining(["app", "owe", "me", "help"]));
    expect(names("all_group_chats")).toEqual(expect.arrayContaining(["status", "table", "help"]));
    expect(names("all_group_chats")).not.toContain("payout");
    expect(names("all_chat_administrators")).toEqual(expect.arrayContaining(["status", "admin", "payout"]));
  });

  it("describes every command in Telegram's limits", async () => {
    for (const [commands] of await run()) {
      for (const { command, description } of commands) {
        expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
        expect(description.length).toBeGreaterThan(2);
        expect(description.length).toBeLessThanOrEqual(256);
      }
    }
  });

  it("doesn't stop the bot starting if Telegram refuses", async () => {
    await expect(
      syncCommands({ setMyCommands: async () => Promise.reject(new Error("down")) }),
    ).resolves.toBeUndefined();
  });
});
