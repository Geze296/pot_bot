import { t, type MessageKey } from "../i18n/index.js";

type Scope = { type: "all_private_chats" } | { type: "all_group_chats" } | { type: "all_chat_administrators" };

const entries = (names: string[]) =>
  names.map((command) => ({ command, description: t("en", `menu.${command}` as MessageKey) }));

const PRIVATE = ["app", "status", "owe", "me", "table", "awards", "nofun", "help"];
const GROUP = ["status", "table", "awards", "roast", "app", "help"];
const MANAGERS = ["admin", "payout", "markpaid", "override"];

/** Fills Telegram's "/" menu. Group admins also see the manager commands. A failure doesn't stop startup. */
export async function syncCommands(api: {
  setMyCommands: (commands: { command: string; description: string }[], other: { scope: Scope }) => Promise<unknown>;
}): Promise<void> {
  try {
    await api.setMyCommands(entries(PRIVATE), { scope: { type: "all_private_chats" } });
    await api.setMyCommands(entries(GROUP), { scope: { type: "all_group_chats" } });
    await api.setMyCommands(entries([...GROUP, ...MANAGERS]), { scope: { type: "all_chat_administrators" } });
  } catch (error) {
    console.error("Couldn't set the command menu:", error);
  }
}
