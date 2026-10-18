// Minimal typings for the Chrome extension APIs Quest uses. Only what we call.
declare namespace chrome {
  namespace runtime {
    const id: string | undefined;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function sendMessage(message: unknown): Promise<unknown>;
    const onMessage: { addListener(cb: (message: any, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void };
    const onInstalled: { addListener(cb: () => void): void };
    const onStartup: { addListener(cb: () => void): void };
  }
  namespace storage {
    interface StorageChange { oldValue?: unknown; newValue?: unknown }
    const local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    const onChanged: {
      addListener(cb: (changes: Record<string, StorageChange>, area: string) => void): void;
      removeListener(cb: (changes: Record<string, StorageChange>, area: string) => void): void;
    };
  }
  namespace tabs {
    function create(props: { url: string }): Promise<unknown>;
    function query(info: { url?: string | string[] }): Promise<{ id?: number; windowId?: number }[]>;
    function update(id: number, props: { active?: boolean; url?: string }): Promise<unknown>;
  }
  namespace windows {
    function update(id: number, props: { focused?: boolean }): Promise<unknown>;
  }
  namespace action {
    function setBadgeText(details: { text: string }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    function setTitle(details: { title: string }): Promise<void>;
  }
  namespace alarms {
    function create(name: string, info: { when?: number; periodInMinutes?: number; delayInMinutes?: number }): void;
    const onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
  }
  namespace notifications {
    function create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string; priority?: number }): void;
    const onClicked: { addListener(cb: (id: string) => void): void };
  }
}
