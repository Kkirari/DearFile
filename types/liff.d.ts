import type Liff from "@line/liff";

declare global {
  interface Window {
    liff: typeof Liff;
  }
}
