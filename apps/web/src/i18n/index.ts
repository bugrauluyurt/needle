import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "../state/settings.ts";
import { english } from "./locales/en.ts";
import type { TranslationKey } from "./locales/en.ts";
import { turkish } from "./locales/tr.ts";

type TranslationValues = Record<string, number | string>;

const resources = {
  en: { translation: english },
  tr: { translation: turkish },
} as const;

void i18next.use(initReactI18next).init({
  defaultNS: "translation",
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
  keySeparator: false,
  lng: "en",
  resources,
});

function applyDocumentLanguage(language: Language) {
  if (typeof document === "undefined" || !document.documentElement) return;

  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
  document.title = translate("app.title");
  document
    .querySelector<HTMLMetaElement>("meta[name='description']")
    ?.setAttribute("content", translate("app.description"));
  document
    .querySelector<HTMLLinkElement>("link[rel='manifest']")
    ?.setAttribute("href", language === "tr" ? "/manifest.tr.webmanifest" : "/manifest.webmanifest");
}

export function translate(key: TranslationKey, values: TranslationValues = {}): string {
  return i18next.t(key, values);
}

export async function changeLanguage(language: Language): Promise<void> {
  await i18next.changeLanguage(language);

  applyDocumentLanguage(language);
}

applyDocumentLanguage("en");

export { i18next };
