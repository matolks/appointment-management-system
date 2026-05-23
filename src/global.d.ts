import type { PersistedAppState } from "./types";

export {};

declare global {
  interface Window {
    appStorage?: {
      load: () => Promise<PersistedAppState | null>;
      save: (state: PersistedAppState) => Promise<boolean>;
      reset: () => Promise<boolean>;
    };
  }
}