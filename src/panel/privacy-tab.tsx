// privacy-tab.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Button, Callout, Checkbox, Separator, KeyValue, read, Row, Select, set, Spinner, Stack, Text, update } from 'orca'
import { t, UI_LANGUAGES, uiLanguageSetting } from '../i18n.ts'
import { PRIVACY_KEYS } from '../privacy.ts'
import { tab, dataSummary, privacy, confirmWipe, models, defaults } from './state.ts'
import { changeUiLanguage, setSetting, setRoles, clearData } from './actions.ts'
import { UI_LANGUAGE_LABELS, NoticeBar, Hint, Section } from './common.tsx'

export const PRIVACY_ROWS: { key: (typeof PRIVACY_KEYS)[number]; label: string; hint: string }[] = [
  { key: 'allowProjectFiles', label: 'Read project files', hint: 'Agent rules, README, manifest files and the file list of the focused workspace (Standard level and above). Off: only workspace and agent names are used.' },
  { key: 'allowGit', label: 'Run git', hint: 'Read-only git status, log, diff, ls-files and grep in the focused workspace (Deep and Max levels).' },
  { key: 'allowTerminalRead', label: 'Read terminal output', hint: 'The last lines of the terminal you picked, at the Max level only.' },
  { key: 'allowTerminalSend', label: 'Send to terminals', hint: 'Type the prompt into the terminal you pick when you click Send. Off: use Copy instead.' },
  { key: 'saveHistory', label: 'Save history', hint: 'Keep your prompts and enhanced prompts in the History tab, on this machine only.' },
  { key: 'allowEnvKeys', label: 'Use API keys from environment variables', hint: 'OPENAI_API_KEY, ANTHROPIC_API_KEY and the others, when a model has no saved key.' },
  { key: 'allowOnlineModelLists', label: 'Fetch model lists online', hint: "GET /models from your API providers and the public Claude Code settings schema, to keep model menus current. CLI lists are always local." }
]

export function PrivacyTab() {
  const flags = read(privacy)
  const data = read(dataSummary)
  const prefs = read(defaults)
  const view = read(models)
  // The hook has 2 s: only enabled API models can answer in time (subscription CLIs start too slowly).
  const hookModels = (view?.profiles ?? []).filter((profile) => profile.enabled && profile.provider !== 'cli')
  const roleOptions = [
    { value: 'chain', label: t('Same as the chain') },
    ...hookModels.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.effectiveModel}` }))
  ]
  const hookValue = hookModels.some((profile) => profile.id === view?.hookProfileId) ? (view?.hookProfileId ?? 'chain') : 'chain'
  return (
    <Stack gap="md">
      <Section title={t('Language')}>
        <Select
          label={t('Panel language')}
          labelHidden
          value={read(uiLanguageSetting)}
          options={UI_LANGUAGES.map((value) => ({ value, label: UI_LANGUAGE_LABELS[value] }))}
          onChange={(value) => void changeUiLanguage(value)}
        />
      </Section>
      <Separator />
      <Section
        title={t('Auto-enhance')}
        hint={t('Launch, task and orchestration prompts. Prompts you type yourself are never changed. The text for Rules is in Settings → Plugins → Enhance Prompt.')}
      >
        <Select
          label={t('Auto-enhance prompts Orca sends to agents')}
          labelHidden
          value={prefs.autoEnhanceMode}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'rules', label: t('Rules: append your text') },
            { value: 'ai', label: t('AI rewrite (fast API model, 2 s limit)') }
          ]}
          onChange={(value) => void setSetting('autoEnhanceMode', value)}
        />
        {view && prefs.autoEnhanceMode === 'ai' && hookModels.length === 0 ? (
          <Callout tone="warning" title={t('Auto-enhance (AI) has no model to use')}>
            <Row gap="xs" justify="between" wrap>
              <Text size="sm">{t('It needs an enabled API model: subscription CLIs take too long for its 2 s limit. Add one in Models, or use Rules.')}</Text>
              <Button size="sm" variant="outline" icon="agent" onPress={() => set(tab, 'models')}>
                {t('Open Models')}
              </Button>
            </Row>
          </Callout>
        ) : null}
        {view && hookModels.length > 1 && !view.fromEnv && prefs.autoEnhanceMode === 'ai' ? (
          <Select
            label={t('Auto-enhance hook model (needs to answer in under 2 s)')}
            value={hookValue}
            options={roleOptions}
            onChange={(value) => void setRoles({ hookProfileId: value === 'chain' ? null : value })}
          />
        ) : null}
      </Section>
      <Separator />
      <Section title={t('What it may use')} hint={t('Orca asks once for everything this plugin may do. These switches decide what it actually uses; the plugin checks them every time.')}>
        <Stack gap="xs">
          {PRIVACY_ROWS.map((row) => (
            <Row key={row.key} gap="xs">
              <Checkbox
                label={t(row.label)}
                checked={flags[row.key] !== false}
                onChange={(value) => {
                  update(privacy, (map) => ({ ...map, [row.key]: value }))
                  void setSetting(row.key, value)
                }}
              />
              <Hint text={t(row.hint)} />
            </Row>
          ))}
        </Stack>
      </Section>
      <Separator />
      <Section title={t('Stored on this machine')} hint={t('Nothing is sent anywhere except your prompt and the context you allow, to the model you run. No tracking or analytics.')}>
        {data ? (
          <KeyValue
            label={t('Stored on this machine')}
            items={[
              { label: t('History'), value: String(data.history) },
              { label: t('Saved models'), value: String(data.profiles) },
              { label: t('API keys (encrypted by Orca)'), value: String(data.keys) },
              { label: t('Cached model lists'), value: String(data.catalogs) }
            ]}
          />
        ) : (
          <Spinner label={t('Loading')} />
        )}
        <Row gap="xs" wrap>
          <Button size="sm" variant="outline" icon="delete" onPress={() => void clearData('history')}>
            {t('Clear history')}
          </Button>
          <Button size="sm" variant="outline" icon="refresh" onPress={() => void clearData('catalogs')}>
            {t('Clear model lists')}
          </Button>
          <Button size="sm" variant={read(confirmWipe) ? 'solid' : 'ghost'} tone="danger" icon="warning" onPress={() => (read(confirmWipe) ? void clearData('all') : set(confirmWipe, true))}>
            {read(confirmWipe) ? t('Press again to delete everything') : t('Delete everything')}
          </Button>
        </Row>
      </Section>
      <NoticeBar />
    </Stack>
  )
}
