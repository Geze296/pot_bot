import { describe, expect, it, vi } from "vitest";
import { syncMenuButton } from "./app.js";

const api = () => ({ setChatMenuButton: vi.fn(async () => true) });

describe("syncMenuButton", () => {
  it("points the menu button at the app", async () => {
    const telegram = api();
    await syncMenuButton(telegram, "https://bot.example.com");

    expect(telegram.setChatMenuButton).toHaveBeenCalledWith({
      menu_button: { type: "web_app", text: "Open app", web_app: { url: "https://bot.example.com" } },
    });
  });

  it("clears a button left over from an earlier address when there's none", async () => {
    const telegram = api();
    await syncMenuButton(telegram, undefined);

    expect(telegram.setChatMenuButton).toHaveBeenCalledWith({ menu_button: { type: "default" } });
  });

  it("doesn't stop the bot starting if Telegram refuses", async () => {
    const telegram = { setChatMenuButton: vi.fn(async () => Promise.reject(new Error("down"))) };

    await expect(syncMenuButton(telegram, undefined)).resolves.toBeUndefined();
  });
});
