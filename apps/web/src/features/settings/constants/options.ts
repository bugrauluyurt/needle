import type { TranslationKey } from "../../../i18n/locales/en.ts";
import { translate } from "../../../i18n/index.ts";
import type { Language, Quality } from "../../../state/settings.ts";

export const LANGUAGES = [
  ["en", "language.english"],
  ["tr", "language.turkish"],
] as const satisfies readonly (readonly [Language, TranslationKey])[];

export const qualityOptions = (): [Quality, string][] => [
  ["original", translate("settings.original")],
  ["320", "320 kbps"],
  ["192", "192 kbps"],
];
