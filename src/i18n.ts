// Panel UI translations. The English text is the key; vi and zh map it to their wording.
// `{name}` placeholders are filled from params. Missing entries fall back to English.
// The dictionaries live in src/i18n-dict.ts (no imports, so the worker reads them too).
import { atom, env, read } from 'orca'
import { resolveLanguage, translate, VI, ZH, type UiLanguage } from './i18n-dict.ts'

export { resolveLanguage, translate, type UiLanguage }
export const UI_LANGUAGES = ['auto', 'en', 'vi', 'zh'] as const

/** The `uiLanguage` setting: 'auto' follows Orca's own language. */
export const uiLanguageSetting = atom<string>('uiLanguage', 'auto')

export function currentLanguage(): UiLanguage {
  return resolveLanguage(read(uiLanguageSetting), env.locale ?? 'en')
}

/** Translates for the current panel language; reading it while rendering re-renders on a switch. */
export function t(text: string, params?: Record<string, string | number>): string {
  return translate(currentLanguage(), text, params)
}

export const dictionaries = { vi: VI, zh: ZH }
