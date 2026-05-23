export {};

declare global {
  interface Window {
    appStorage: {
      load: () => Promise<any | null>;
      save: (state: any) => Promise<boolean>;
    };
  }
}