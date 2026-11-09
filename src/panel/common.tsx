// common.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Heading, IconButton, read, Row, set, Stack, Text, type OrcaNode, Box } from 'orca'
import { t } from '../i18n.ts'
import { notice } from './state.ts'
export { UI_LANGUAGE_LABELS, OUTPUT_LANGUAGE_LABELS, outputOptions, modelOptions, styleOptions, levelOptions, KEY_LABEL, seconds, MODEL_SEP, PROFILE_DEFAULT, modelDisplay, modelName, shortModelName } from './view.ts'

// ---------------------------------------------------------------- view

export function NoticeBar() {
  const current = read(notice)
  if (!current) return null
  return (
    // A tinted line with the message and a close button (a Callout added an untranslated "Note" heading).
    <Box direction="row" align="center" justify="between" gap="xs" paddingX="sm" paddingY="xs" radius="md" background={current.tone === 'neutral' ? 'muted' : current.tone}>
      <Text size="sm" tone={current.tone === 'neutral' ? undefined : current.tone}>
        {current.text}
      </Text>
      <IconButton icon="close" label={t('Dismiss')} size="sm" variant="ghost" onPress={() => set(notice, null)} />
    </Box>
  )
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
