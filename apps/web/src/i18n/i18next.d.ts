import "i18next";
import type { english } from "./locales/en.ts";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    keySeparator: false;
    resources: {
      translation: typeof english;
    };
  }
}
