// models-tab.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Badge, Box, Button, Callout, EmptyState, Separator, IconButton, Input, read, Row, Select, set, Spinner, Stack, Switch, Text } from 'orca'
import { presetById, type ProfileView } from '../presets.ts'
import { t } from '../i18n.ts'
import { type Form, form, detected, catalogs, catalogLoading, CUSTOM_MODEL, CLI_DEFAULT, toModel, customModel, busy, models, defaults } from './state.ts'
import { loadCatalog, formCatalogInput, setSetting, openForm, addDetected, applyPreset, patchForm, saveForm, modelAction, toggleProfile, testProfile, setRoles, switchModel } from './actions.ts'
import { modelOptions, KEY_LABEL, NoticeBar, Hint, Section } from './common.tsx'

/** A list of the models the CLI or API offers now, with "Other" to type any id. */
export function ModelPicker({ current }: { current: Form }) {
  const catalog = read(catalogs).form
  const loading = read(catalogLoading).form === true
  const cli = current.provider === 'cli'
  const options = modelOptions(catalog, current.model)
  const inList = options.some((option) => option.value === current.model)
  const typing = read(customModel) || (current.model !== '' && !inList)
  const label = cli ? t('Model (optional)') : t('Model')
  return (
    <Stack gap="xs">
      <Row gap="xs">
        {options.length > 0 ? (
          <Select
            label={label}
            placeholder={cli ? t('CLI default') : presetById(current.preset).model || t('Choose a model')}
            value={typing ? CUSTOM_MODEL : current.model || (cli ? CLI_DEFAULT : undefined)}
            options={[...(cli ? [{ value: CLI_DEFAULT, label: t('CLI default') }] : []), ...options, { value: CUSTOM_MODEL, label: t('Other (type the id)…') }]}
            onChange={(value) => {
              set(customModel, value === CUSTOM_MODEL)
              if (value !== CUSTOM_MODEL) patchForm({ model: toModel(value) })
            }}
          />
        ) : (
          <Input
            label={label}
            placeholder={presetById(current.preset).model || (cli ? t('CLI default') : 'model-id')}
            value={current.model}
            onChange={(value) => patchForm({ model: value })}
          />
        )}
        <IconButton
          icon="refresh"
          label={t('Refresh model list')}
          variant="ghost"
          disabled={loading}
          onPress={() => void loadCatalog('form', formCatalogInput(current), true)}
        />
      </Row>
      {options.length > 0 && typing ? (
        <Input label={t('Model id')} labelHidden placeholder="model-id" value={current.model} onChange={(value) => patchForm({ model: value })} />
      ) : null}
      <Text muted size="xs">
        {loading
          ? t('Loading the model list…')
          : catalog?.error
            ? t('Could not load the list ({error}). Type the model id.', { error: catalog.error })
            : catalog && catalog.models.length > 0
              ? t('{count} models from {source}, refreshed daily.', { count: catalog.models.length, source: catalog.source })
              : cli
                ? t('Uses the model set in the CLI itself.')
                : t('Add the API key to list the models.')}
      </Text>
    </Stack>
  )
}

export function ProfileForm() {
  const current = read(form)
  const view = read(models)
  if (!current || !view) return null
  const custom = current.preset === 'custom'
  const cli = current.provider === 'cli'
  const editing = Boolean(current.id)
  const keyHint = editing
    ? t('Leave empty to keep the saved key')
    : presetById(current.preset).env
      ? t('Or set {env}', { env: presetById(current.preset).env })
      : t('Not needed for local servers')
  return (
    <Box gap="sm" padding="md" border="accent" radius="md">
      <Text weight="semibold">{editing ? t('Edit {name}', { name: current.name }) : t('Add a model')}</Text>
      <Select label={t('Preset')} value={current.preset} options={view.presets.map((preset) => ({ value: preset.id, label: preset.label }))} onChange={applyPreset} />
      <Input label={t('Name')} value={current.name} onChange={(value) => patchForm({ name: value })} />
      {custom ? (
        <Select
          label={t('API format')}
          value={current.provider}
          options={[
            { value: 'openai', label: 'OpenAI-compatible (/chat/completions)' },
            { value: 'anthropic', label: 'Anthropic (/v1/messages)' }
          ]}
          onChange={(value) => patchForm({ provider: value === 'anthropic' ? 'anthropic' : 'openai' })}
        />
      ) : null}
      {cli ? (
        <Stack gap="sm">
          <Row gap="xs">
            <Text muted size="xs">
              {t('Uses your subscription')}
            </Text>
            <Hint text={t('Runs the CLI already signed in on this machine, so it uses your subscription instead of an API key. Slower than an API (a few seconds per call), so it is skipped by auto-enhance.')} />
          </Row>
          <Input
            label={t('Command')}
            placeholder={current.preset === 'custom-cli' ? 'my-llm' : t('Found on PATH automatically; or a full path')}
            value={current.command ?? ''}
            onChange={(value) => patchForm({ command: value })}
          />
          {current.preset === 'custom-cli' ? (
            <Input label={t('Arguments')} placeholder="run --quiet" value={current.args ?? ''} onChange={(value) => patchForm({ args: value })} />
          ) : null}
        </Stack>
      ) : (
        <Input label={t('Base URL')} placeholder={presetById(current.preset).baseUrl || 'https://…'} value={current.baseUrl} onChange={(value) => patchForm({ baseUrl: value })} />
      )}
      <ModelPicker current={current} />
      {cli ? null : (
        <Input label={t('API key')} type="password" placeholder={keyHint} value={current.apiKey} onChange={(value) => patchForm({ apiKey: value })} />
      )}
      {cli ? null : <Row gap="xs" wrap>
        <Select
          label={t('Temperature')}
          value={String(current.temperature)}
          options={['0', '0.2', '0.3', '0.5', '0.7', '1'].map((value) => ({ value, label: t('Temperature {value}', { value }) }))}
          onChange={(value) => patchForm({ temperature: Number(value) })}
        />
        <Select
          label={t('Max tokens')}
          value={String(current.maxTokens)}
          options={['1000', '2000', '4000', '8000', '16000'].map((value) => ({ value, label: t('{value} tokens', { value }) }))}
          onChange={(value) => patchForm({ maxTokens: Number(value) })}
        />
      </Row>}
      <Row gap="xs">
        <Button
          icon="check"
          onPress={() => void saveForm()}
          disabled={
            !current.name.trim() ||
            (cli ? current.preset === 'custom-cli' && !current.command?.trim() : !(current.baseUrl.trim() || presetById(current.preset).baseUrl)) ||
            read(busy) === 'save'
          }
        >
          {t('Save')}
        </Button>
        <Button variant="ghost" onPress={() => set(form, null)}>
          {t('Cancel')}
        </Button>
      </Row>
    </Box>
  )
}

/** The profile's model, switchable in place from the live list. */
export function QuickModel({ profile, fromEnv }: { profile: ProfileView; fromEnv: boolean }) {
  const options = modelOptions(read(catalogs)[profile.id], profile.effectiveModel)
  if (fromEnv || options.length < 2) {
    return (
      <Text muted size="xs" truncate>
        {profile.effectiveModel || t('CLI default')}
      </Text>
    )
  }
  return (
    <Select
      label={t('Model')}
      labelHidden
      value={profile.effectiveModel || CLI_DEFAULT}
      options={[...(profile.provider === 'cli' ? [{ value: CLI_DEFAULT, label: t('CLI default') }] : []), ...options]}
      onChange={(value) => void switchModel(profile, toModel(value))}
    />
  )
}

export function ProfileCard({ profile, index, count, fromEnv }: { profile: ProfileView; index: number; count: number; fromEnv: boolean }) {
  const where = profile.provider === 'cli' ? `${presetById(profile.preset).label.replace(/ \(.*\)$/, '')} CLI` : profile.effectiveBaseUrl
  return (
    <Box gap="xs" padding="sm" border radius="md" background={profile.enabled ? 'none' : 'muted'}>
      <Row justify="between" gap="xs">
        <Row gap="xs">
          {fromEnv || count < 2 ? (
            <Badge tone={profile.enabled ? 'accent' : 'neutral'}>{index + 1}</Badge>
          ) : (
            <Select
              label={t('Order')}
              labelHidden
              value={String(index)}
              options={Array.from({ length: count }, (_, position) => ({ value: String(position), label: `#${position + 1}` }))}
              onChange={(value) => void modelAction({ move: profile.id, to: Number(value) })}
            />
          )}
          <Text weight="medium" truncate muted={!profile.enabled}>
            {profile.name}
          </Text>
        </Row>
        <Row gap="none">
          <IconButton icon="check" label={`${t('Test')} · ${where}`} size="sm" variant="ghost" onPress={() => void testProfile(profile.id)} disabled={read(busy) === 'test'} />
          {fromEnv ? null : (
            <Row gap="none">
              <IconButton
                icon={profile.enabled ? 'pause' : 'play'}
                label={profile.enabled ? t('Disable') : t('Enable')}
                size="sm"
                variant="ghost"
                onPress={() => void toggleProfile(profile, !profile.enabled)}
              />
              <IconButton icon="edit" label={t('Edit')} size="sm" variant="ghost" onPress={() => openForm(profile)} />
              <IconButton icon="delete" label={t('Delete')} size="sm" variant="ghost" tone="danger" onPress={() => void modelAction({ remove: profile.id })} />
            </Row>
          )}
        </Row>
      </Row>
      <Row gap="xs" justify="between" wrap>
        <QuickModel profile={profile} fromEnv={fromEnv} />
        <Badge tone={profile.keySource === 'none' ? 'warning' : profile.enabled ? 'success' : 'neutral'}>
          {profile.enabled ? t(KEY_LABEL[profile.keySource]) : t('off')}
        </Badge>
      </Row>
    </Box>
  )
}

/** Subscription CLIs found on this machine that are not added yet: one click to use them. */
export function SubscriptionCallout() {
  const available = read(detected).filter((entry) => !entry.added)
  if (available.length === 0) return null
  return (
    <Callout tone="success" title={t('Use your subscription, no API key')} icon="agent">
      <Row gap="xs" wrap>
        {available.map((entry) => (
          <Button key={entry.preset} size="sm" variant="outline" icon="add" tooltip={`${t('Found on this machine. Uses the account the CLI is signed in with.')} ${entry.path}`} onPress={() => void addDetected(entry.preset, entry.path)}>
            {entry.label.replace(/ \(.*\)$/, '')}
          </Button>
        ))}
      </Row>
    </Callout>
  )
}

export function ModelsTab() {
  const view = read(models)
  const prefs = read(defaults)
  if (!view) return <Spinner label={t('Loading')} />
  const roleOptions = [
    { value: 'chain', label: t('Same as the chain') },
    ...view.profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.effectiveModel || t('CLI default')}` }))
  ]
  return (
    <Stack gap="md">
      <Section title={t('Your models')} hint={t('Models are tried top to bottom. Disabled models are skipped.')}>
        {view.fromEnv && view.profiles.length > 0 ? (
          <Callout tone="accent" title={t('Using API keys from your environment')}>
            <Text size="sm">{t('Add a model below to customize; then only your saved models are used.')}</Text>
          </Callout>
        ) : null}
        <SubscriptionCallout />
        {view.profiles.length === 0 && !read(form) ? (
          <EmptyState
            icon="agent"
            title={t('No models yet')}
            description={t('Use a subscription CLI above, or add OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio or any OpenAI-compatible endpoint.')}
          />
        ) : null}
        <Stack gap="xs">
          {view.profiles.map((profile, index) => (
            <ProfileCard key={profile.id} profile={profile} index={index} count={view.profiles.length} fromEnv={view.fromEnv} />
          ))}
        </Stack>
        <NoticeBar />
        {read(form) ? (
          <ProfileForm />
        ) : (
          <Row>
            <Button variant="outline" icon="add" onPress={() => openForm()}>
              {t('Add model')}
            </Button>
          </Row>
        )}
      </Section>
      <Separator />
      <Section title={t('Fallback')}>
        <Switch label={t('Fallback to the next model when one fails')} checked={prefs.fallbackEnabled} onChange={(value) => void setSetting('fallbackEnabled', value)} />
        {prefs.fallbackEnabled ? (
        <Select
          label={t('Fall back on')}
          labelHidden
          value={prefs.fallbackOn}
          options={[
            { value: 'any', label: t('Any error (bad key, unknown model, network…)') },
            { value: 'transient', label: t('Only network, timeout, rate limit, 5xx') }
          ]}
          onChange={(value) => void setSetting('fallbackOn', value)}
        />
        ) : null}
      </Section>
      {view.profiles.length > 1 && !view.fromEnv ? (
        <Stack gap="lg">
          <Separator />
          <Section title={t('Max context level')}>
            <Select
              label={t('File picker model (Max context level)')}
              value={view.selectorProfileId ?? 'chain'}
              options={roleOptions}
              onChange={(value) => void setRoles({ selectorProfileId: value === 'chain' ? null : value })}
            />
          </Section>
        </Stack>
      ) : null}
    </Stack>
  )
}
