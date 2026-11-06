interface WebApp {
  initData: string;
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

export function startTelegram(): void {
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
