interface WebApp {
  initData: string;
  colorScheme?: "light" | "dark";
  onEvent?: (event: string, handler: () => void) => void;
  ready: () => void;
  expand: () => void;
  platform: string;
  isVersionAtLeast: (version: string) => boolean;
  showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

const webApp = () => window.Telegram?.WebApp;

export const initData = (): string => webApp()?.initData ?? "";

/** Telegram's theme can differ from the phone's, so the app's own colours follow Telegram's. */
function applyTheme(): void {
  const scheme = webApp()?.colorScheme;
  if (scheme) document.documentElement.dataset.theme = scheme;
}

export function startTelegram(): void {
  applyTheme();
  webApp()?.onEvent?.("themeChanged", applyTheme);
  webApp()?.ready();
  webApp()?.expand();
}

/** Telegram's own dialog where it exists. A plain browser, like a laptop, gets the browser's. */
export function confirmAction(message: string): Promise<boolean> {
  const app = webApp();
  if (app && app.platform !== "unknown" && app.isVersionAtLeast("6.2")) {
    return new Promise((resolve) => app.showConfirm(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}
