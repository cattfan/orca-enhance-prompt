// common.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Callout, Heading, IconButton, read, Row, set, Stack, Text, type OrcaNode } from 'orca'
import { CONTEXT_LEVEL_LABELS, CONTEXT_LEVELS, type ProfileView } from '../presets.ts'
import { STYLE_LABELS, STYLES } from '../prompts.ts'
import { t } from '../i18n.ts'
import { type Catalog, notice, defaults } from './state.ts'

export const UI_LANGUAGE_LABELS: Record<string, string> = { auto: 'Auto', en: 'EN', vi: 'VI', zh: '中文' }
export const OUTPUT_LANGUAGE_LABELS: Record<string, string> = {
  auto: 'Output: same as prompt',
  en: 'Output: English',
  vi: 'Output: Vietnamese',
  zh: 'Output: Chinese'
}

export function outputOptions() {
  const fallback = read(defaults).outputLanguage
  const defaultLabel = OUTPUT_LANGUAGE_LABELS[fallback] ? t(OUTPUT_LANGUAGE_LABELS[fallback]) : fallback
  return [
    { value: 'default', label: t('Output: default ({value})', { value: defaultLabel.replace(/^[^:：]+[:：]\s*/, '') }) },
    ...Object.entries(OUTPUT_LANGUAGE_LABELS).map(([value, label]) => ({ value, label: t(label) }))
  ]
}

export function modelOptions(catalog: Catalog | undefined, current: string) {
  const options = (catalog?.models ?? []).map((model) => ({
    value: model.id,
    label: model.isDefault ? `${modelName(model.id, model.label, model.description)} · ${t('your default')}` : modelName(model.id, model.label, model.description)
  }))
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current })
  return options
}

// ---------------------------------------------------------------- view

export const styleOptions = () => STYLES.map((value) => ({ value, label: t(STYLE_LABELS[value]) }))
export const levelOptions = () => CONTEXT_LEVELS.map((value) => ({ value, label: t(CONTEXT_LEVEL_LABELS[value]) }))
export const KEY_LABEL: Record<ProfileView['keySource'], string> = {
  secret: 'key saved',
  env: 'key from env',
  none: 'no key',
  'not-needed': 'local',
  subscription: 'subscription'
}

export function NoticeBar() {
  const current = read(notice)
  if (!current) return null
  return (
    <Callout tone={current.tone === 'neutral' ? undefined : current.tone}>
      <Row justify="between" gap="xs">
        <Text size="sm">{current.text}</Text>
        <IconButton icon="close" label={t('Dismiss')} size="sm" variant="ghost" onPress={() => set(notice, null)} />
      </Row>
    </Callout>
  )
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export const MODEL_SEP = '|'
export const PROFILE_DEFAULT = '__profile_default__'

/** "sonnet: Sonnet, newest" -> "Sonnet, newest"; display names stay as they are. */
export const modelDisplay = (label: string) => (label.includes(': ') ? label.slice(label.indexOf(': ') + 2) : label)

/** Aliases ("sonnet: Sonnet, newest") read "sonnet — Sonnet, newest"; named models read "Fable 5.1 — For…". */
export function modelName(id: string, label: string, description?: string): string {
  if (label.includes(': ')) return `${id} — ${modelDisplay(label)}`
  const short = description ? (description.length > 42 ? `${description.slice(0, 40)}…` : description) : ''
  return short ? `${label} — ${short}` : label
}

/** Composer names: "Fable 5.1", "GPT-6.1-Sol", or for an alias "sonnet (latest)". */
export function shortModelName(id: string, label: string): string {
  if (label.includes(': ')) return `${id} (${t('latest')})`
  return label || id
}

/** Help text behind an info icon: hover shows it, a press shows it as a notice (touch, keyboard). */
export function Hint({ text }: { text: string }) {
  return <IconButton icon="info" label={text} size="sm" variant="ghost" onPress={() => set(notice, { tone: 'neutral', text })} />
}

export function Section({ title, hint, children }: { title: string; hint?: string; children?: OrcaNode }) {
  return (
    <Stack gap="sm">
      <Row gap="xs">
        <Heading level={3}>{title}</Heading>
        {hint ? <Hint text={hint} /> : null}
      </Row>
      {children}
    </Stack>
  )
}
