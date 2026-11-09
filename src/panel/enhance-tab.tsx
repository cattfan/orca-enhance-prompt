// enhance-tab.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Badge, Box, Button, Callout, Checkbox, Collapsible, Grid, IconButton, read, RelativeTime, Row, Select, set, Progress, Spinner, Stack, Switch, Text, Textarea, update, Input } from 'orca'
import { CONTEXT_LEVEL_LABELS, isContextLevel, type ContextItemView } from '../presets.ts'
import { isStyle, STYLE_LABELS } from '../prompts.ts'
import { t } from '../i18n.ts'
import { MAX_IMAGES } from '../image-limits.ts'
import { BUILT_IN_STRUCTURES, structureById } from '../rules.ts'
import { rulesConfig } from './rules-tab.tsx'
import { ESTIMATED_STEPS, stepPercent, totalPercent, type Step } from '../progress.ts'
import { images, imagesOpen, imageDraft, tick, workspaceKey, structureChoice, fixOpen, errorTerminal, tab, draft, result, style, level, profileChoice, modelChoice, outputChoice, excluded, target, pressEnter, catalogs, run, optionsOpen, busy, lastRun, contextShown, contextNotes, put, targets, models, defaults, effectiveStyle, effectiveLevel, effectiveEnter, enabledProfiles, say } from './state.ts'
import { addImage, removeImage, fixError, refreshTargets, enhanceNow, previewContext, cancel, toggleItem, send, copy } from './actions.ts'
import { outputOptions, styleOptions, levelOptions, NoticeBar, seconds, MODEL_SEP, PROFILE_DEFAULT, shortModelName } from './common.tsx'

export function TargetPicker() {
  const list = read(targets)
  return (
    <Row gap="xs">
      <Select
        label={t('Send to')}
        labelHidden
        placeholder={list.length === 0 ? t('No terminals in this workspace') : t('Choose a terminal')}
        value={read(target) ?? undefined}
        options={list.map((item) => ({ value: item.terminalId, label: item.label }))}
        onChange={(value) => set(target, value)}
        disabled={list.length === 0}
      />
      <IconButton icon="refresh" label={t('Refresh terminals')} variant="ghost" onPress={() => void refreshTargets()} />
    </Row>
  )
}

/** Context item names and kinds come from the worker in English; show them in the panel's language. */
export function contextKind(kind: string): string {
  const kinds: Record<string, () => string> = {
    workspace: () => t('workspace'),
    agent: () => t('agent'),
    rules: () => t('rules'),
    stack: () => t('stack'),
    tree: () => t('tree'),
    git: () => t('git'),
    file: () => t('file'),
    terminal: () => t('terminal'),
    error: () => t('error')
  }
  return kinds[kind]?.() ?? kind
}

/** Why an item is in the context (keyword match, picked by AI, trimmed), after a separator. */
export function itemWhy(item: ContextItemView): string {
  if (item.why) return ` · ${say(item.why)}`
  return item.note ? ` · ${item.note}` : ''
}

export function ContextPanel() {
  const shown = read(contextShown)
  const notes = read(contextNotes)
  if (shown.length === 0 && notes.length === 0) return null
  const ex = new Set(read(excluded))
  const included = shown.filter((item) => !ex.has(item.id))
  const chars = included.reduce((sum, item) => sum + item.chars, 0)
  return (
    <Collapsible title={t('Context · {count} items · {chars} chars', { count: included.length, chars: chars.toLocaleString() })}>
      <Stack gap="xs">
        {shown.map((item) => (
          <Checkbox
            key={item.id}
            label={item.title ? say(item.title) : item.label}
            description={`${t('{kind} · {chars} chars', { kind: contextKind(item.kind), chars: item.chars.toLocaleString() })}${itemWhy(item)}`}
            checked={!ex.has(item.id)}
            onChange={(checked) => toggleItem(item.id, checked)}
          />
        ))}
        {notes.map((note) => (
          <Text key={JSON.stringify(note)} muted size="xs">
            {say(note)}
          </Text>
        ))}
      </Stack>
    </Collapsible>
  )
}

export function RunInfo() {
  const info = read(lastRun)
  if (!info) return null
  const failed = info.attempts.filter((attempt) => !attempt.ok)
  return (
    <Stack gap="none">
      <Text muted size="xs" truncate>
        {`${info.profileName} · ${info.model} · ${t('edit freely before sending')}`}
      </Text>
      {failed.length > 0 ? (
        <Text tone="warning" size="xs">
          {t('Fell back after: {list}', { list: failed.map((attempt) => `${attempt.name} (${attempt.errorText ? say(attempt.errorText) : (attempt.error ?? 'failed')})`).join(', ') })}
        </Text>
      ) : null}
    </Stack>
  )
}

export const STEP_LABELS: Record<Step['key'], string> = {
  error: 'Reading the error',
  workspace: 'Reading workspace',
  project: 'Reading project rules and stack',
  git: 'Reading git changes',
  search: 'Finding relevant code',
  pick: 'AI picking files',
  terminal: 'Reading terminal output',
  model: 'Writing the prompt'
}
export const STEP_GLYPH: Record<Step['status'], string> = { pending: '○', running: '●', done: '✓', skipped: '–', failed: '✕' }

export function stepText(entry: Step): string {
  const label = t(STEP_LABELS[entry.key])
  if (!entry.detail) return label
  const count = Number(entry.detail)
  if (entry.key === 'workspace' || entry.key === 'model' || !Number.isFinite(count)) return `${label} · ${entry.detail}`
  if (entry.key === 'terminal') return `${label} · ${t('{count} lines', { count })}`
  if (entry.key === 'git') return `${label} · ${t('{count} changed', { count })}`
  return `${label} · ${t('{count} files', { count })}`
}

/** A step's share as shown: "≈" when estimated from time, "–" when skipped. */
export function stepShare(entry: Step, now: number): string {
  const share = stepPercent(entry, now)
  if (share === null) return '–'
  const estimated = entry.status === 'running' && entry.fraction === undefined && ESTIMATED_STEPS.has(entry.key)
  return `${estimated ? '≈' : ''}${share}%`
}

/** One step: what it is on the left (cut when the panel is narrow), its share on the right; a bar under the running one. */
function StepRow({ entry, now }: { entry: Step; now: number }) {
  const running = entry.status === 'running'
  const tone = entry.status === 'failed' ? 'danger' : running ? 'accent' : undefined
  const muted = entry.status === 'pending' || entry.status === 'skipped'
  return (
    <Stack gap="none">
      <Row justify="between" gap="xs">
        <Text size="xs" truncate muted={muted} tone={tone}>
          {`${STEP_GLYPH[entry.status]}  ${stepText(entry)}`}
        </Text>
        <Text size="xs" muted={!running} tone={tone}>
          {stepShare(entry, now)}
        </Text>
      </Row>
      {running ? <Progress label={t('{step}: {percent}%', { step: t(STEP_LABELS[entry.key]), percent: stepPercent(entry, now) ?? 0 })} labelHidden value={stepPercent(entry, now) ?? 0} /> : null}
    </Stack>
  )
}

/** Live progress of the current run, then how it ended when it did not end well. */
export function RunCard() {
  const current = read(run)
  if (!current || current.status === 'done') return null
  const running = current.status === 'running'
  // A run started in another project: say whose it is, show none of its details here.
  if (current.workspace && current.workspace.key !== read(workspaceKey)) {
    if (!running) return null
    return (
      <Row gap="xs">
        <Spinner label={t('Enhancing')} labelHidden />
        <Text muted size="sm" truncate>
          {t('Writing the prompt for {name}…', { name: current.workspace.name ?? '?' })}
        </Text>
      </Row>
    )
  }
  const steps = current.steps
  const now = read(tick)
  const total = running ? totalPercent(steps, now) : (current.endPercent ?? totalPercent(steps, now))
  const active = steps.find((entry) => entry.status === 'running')
  const estimating = steps.some((entry) => entry.status === 'running' && entry.fraction === undefined && ESTIMATED_STEPS.has(entry.key))
  const finished = steps.filter((entry) => entry.status === 'done' || entry.status === 'skipped')
  const next = steps.find((entry) => entry.status === 'pending')
  // Between steps: the next one; all done: the answer is on its way.
  const idle = finished.length === 0 ? t('Starting…') : next ? stepText(next) : t('Finishing…')
  const title = running
    ? active
      ? stepText(active)
      : idle
    : current.status === 'cancelled'
      ? t('Cancelled')
      : t('Enhance failed')
  return (
    <Box gap="sm" padding="sm" border={current.status === 'error' ? 'danger' : true} radius="md">
      <Row justify="between" gap="xs">
        <Row gap="xs">
          {running ? <Spinner label={t('Enhancing')} labelHidden /> : null}
          {/* The percentage comes first: a narrow panel cuts the title, never the number. */}
          <Text weight="semibold" size="sm">
            {`${total}%`}
          </Text>
          <Text weight="semibold" size="sm" truncate tone={current.status === 'error' ? 'danger' : undefined}>
            {title}
          </Text>
        </Row>
        <Row gap="xs">
          <Text muted size="xs">
            {running ? <RelativeTime at={current.startedAt} format="duration" /> : seconds((current.finishedAt ?? Date.now()) - current.startedAt)}
          </Text>
        </Row>
      </Row>
      <Progress label={t('Progress: {percent}%', { percent: total })} labelHidden value={total} />
      {steps.length > 0 ? (
        <Stack gap="none">
          {steps.map((entry) => (
            <StepRow key={entry.key} entry={entry} now={now} />
          ))}
        </Stack>
      ) : null}
      {estimating ? (
        <Text muted size="xs">
          {t('≈ estimated: a model reports no progress of its own, so its share grows with time and reaches 100% when the answer arrives.')}
        </Text>
      ) : null}
      {current.status === 'error' && current.error ? (
        <Text size="xs" tone="danger">
          {current.error}
        </Text>
      ) : null}
      {running ? null : (
        <Row gap="xs">
          <Button size="sm" variant="outline" icon="refresh" onPress={() => void enhanceNow()}>
            {t('Try again')}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => set(run, null)}>
            {t('Dismiss')}
          </Button>
        </Row>
      )}
    </Box>
  )
}

/** The word before ":" in a level label: "Deep: + git…" → "Deep". */
export const shortLabel = (label: string) => label.split(/[:：]/)[0].trim()

/** Style, context, output and model, folded under a one-line summary of the current choice. */
/** One line naming the current options, used as the options button's tooltip. */
export function optionsSummary(): string {
  const styleValue = read(effectiveStyle)
  const levelValue = read(effectiveLevel)
  const output = outputOptions().find((option) => option.value === read(outputChoice))
  return [
    t(STYLE_LABELS[isStyle(styleValue) ? styleValue : 'balanced']),
    shortLabel(t(CONTEXT_LEVEL_LABELS[isContextLevel(levelValue) ? levelValue : 'standard'])),
    read(outputChoice) !== 'default' && output ? output.label.replace(/^[^:：]+[:：]\s*/, '') : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Style, context, output language and the Enter switch, shown under the composer when opened. */
/** Images attached to the prompt: by path (Orca's panels have no file picker), checked by the worker. */
export function ImagesBox() {
  const list = read(images)
  if (!read(imagesOpen) && list.length === 0) return null
  return (
    <Box gap="sm" padding="sm" radius="md" background="muted">
      {list.map((image) => (
        <Row key={image.path} justify="between" gap="xs">
          <Text size="xs" truncate>
            {`${image.name} · ${(image.bytes / (1024 * 1024)).toFixed(1)} MB`}
          </Text>
          <IconButton icon="close" label={t('Remove {name}', { name: image.name })} size="sm" variant="ghost" onPress={() => removeImage(image.path)} />
        </Row>
      ))}
      {list.length < MAX_IMAGES ? (
        <Row gap="xs">
          <Input
            label={t('Image file path')}
            labelHidden
            placeholder={t('Full path of a PNG, JPEG, GIF or WebP file')}
            value={read(imageDraft)}
            onChange={(value) => set(imageDraft, value)}
            onSubmit={() => void addImage()}
          />
          <Button size="sm" variant="outline" icon="add" onPress={() => void addImage()} disabled={!read(imageDraft).trim()}>
            {t('Attach')}
          </Button>
        </Row>
      ) : null}
      <Text muted size="xs">
        {t('Up to {max} images of 5 MB. Copy a file\'s path: Shift + right-click → Copy as path (Windows), Option + right-click → Copy as Pathname (macOS). Models that can see images use them; the prompt always lists their paths so the agent can open them.', { max: MAX_IMAGES })}
      </Text>
    </Box>
  )
}

/** "Fix this error": pick the terminal showing the error; the prompt goes to the target agent as usual. */
export function FixErrorBox() {
  if (!read(fixOpen)) return null
  const list = read(targets)
  const working = read(busy)
  return (
    <Box gap="sm" padding="sm" radius="md" background="muted">
      <Row gap="xs" wrap>
        <Select
          label={t('Error in')}
          placeholder={list.length === 0 ? t('No terminals in this workspace') : t('Choose a terminal')}
          value={read(errorTerminal) ?? undefined}
          options={list.map((item) => ({ value: item.terminalId, label: item.label }))}
          onChange={(value) => set(errorTerminal, value)}
          disabled={list.length === 0}
        />
        <Button variant="solid" icon="bug" onPress={() => void fixError()} disabled={!read(errorTerminal) || working !== null}>
          {t('Fix this error')}
        </Button>
      </Row>
      <Text muted size="xs">
        {t('Reads the latest error in that terminal (build, tests, dev server) and writes a bug-fix prompt for the agent you send to. Your text above, if any, is added.')}
      </Text>
    </Box>
  )
}

/** "By style" plus every built-in and saved structure. */
export function structureOptions() {
  const config = rulesConfig()
  return [
    { value: 'style', label: t('By style') },
    ...BUILT_IN_STRUCTURES.map((structure) => ({ value: structure.id, label: t(structure.name) })),
    ...config.structures.map((structure) => ({ value: structure.id, label: structure.name }))
  ]
}

/** The picked structure, or "By style" when it was deleted. */
function structureValue(): string {
  const id = read(structureChoice)
  return id && structureById(rulesConfig(), id) ? id : 'style'
}

export function PromptOptions() {
  if (!read(optionsOpen)) return null
  return (
    <Box gap="sm" padding="sm" radius="md" background="muted">
      <Grid columns={2} gap="sm">
        <Select label={t('Style')} value={read(effectiveStyle)} options={styleOptions()} onChange={(value) => set(style, value)} />
        <Select label={t('Context')} value={read(effectiveLevel)} options={levelOptions()} onChange={(value) => set(level, value)} />
        <Select label={t('Output language')} value={read(outputChoice)} options={outputOptions()} onChange={(value) => set(outputChoice, value)} />
        <Select label={t('Structure')} value={structureValue()} options={structureOptions()} onChange={(value) => set(structureChoice, value === 'style' ? '' : value)} />
      </Grid>
      <Switch label={t('Press Enter after sending')} checked={read(effectiveEnter)} onChange={(value) => set(pressEnter, value)} />
    </Box>
  )
}

/** Every model of every enabled profile, from its live list, plus Auto. */
export function modelMenu() {
  const options: { value: string; label: string }[] = [
    { value: 'auto', label: read(defaults).fallbackEnabled ? t('Auto (fallback)') : t('Auto') }
  ]
  for (const profile of read(enabledProfiles)) {
    const catalog = read(catalogs)[profile.id]
    const listed = catalog?.models ?? []
    const seen = new Set<string>()
    const add = (id: string, label: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const saved = id !== '' && id === profile.effectiveModel
      options.push({
        value: `${profile.id}${MODEL_SEP}${id || PROFILE_DEFAULT}`,
        label: `${profile.name} · ${label}${saved ? ` · ${t('default')}` : ''}`
      })
    }
    if (profile.provider === 'cli' && !profile.effectiveModel) add('', t('CLI default'))
    else if (profile.effectiveModel && !listed.some((model) => model.id === profile.effectiveModel)) add(profile.effectiveModel, profile.effectiveModel)
    for (const model of listed) add(model.id, shortModelName(model.id, model.label))
  }
  return options
}

export function currentModelValue(): string {
  const choice = read(profileChoice)
  if (choice === 'auto') return 'auto'
  const profile = read(enabledProfiles).find((entry) => entry.id === choice)
  if (!profile) return 'auto'
  const model = read(modelChoice) || profile.effectiveModel
  return `${choice}${MODEL_SEP}${model || PROFILE_DEFAULT}`
}

export function pickModel(value: string): void {
  if (value === 'auto') {
    set(profileChoice, 'auto')
    set(modelChoice, '')
    return
  }
  const [profileId, model] = value.split(MODEL_SEP)
  const profile = read(enabledProfiles).find((entry) => entry.id === profileId)
  set(profileChoice, profileId)
  // The profile's own model is stored as '' so a later change to the profile follows through.
  set(modelChoice, model === PROFILE_DEFAULT || model === profile?.effectiveModel ? '' : model)
}

/** The model menu in the composer: every model you can use right now, one click away. */
export function ComposerModelPicker() {
  const options = modelMenu()
  const value = currentModelValue()
  return (
    <Select
      label={t('Model')}
      labelHidden
      value={options.some((option) => option.value === value) ? value : 'auto'}
      options={options}
      onChange={pickModel}
    />
  )
}

export function ResultCard({ output }: { output: string }) {
  const working = read(busy)
  return (
    <Box gap="sm" padding="sm" border radius="lg">
      <Row justify="between">
        <Row gap="xs">
          <Text weight="semibold" size="sm">
            {t('Enhanced prompt')}
          </Text>
          {read(lastRun) ? <Badge tone="success">{`${t('Done')} · ${seconds(read(lastRun)!.ms)}`}</Badge> : null}
        </Row>
        <Row gap="none">
          <IconButton icon="copy" label={t('Copy')} size="sm" variant="ghost" onPress={() => void copy(output)} />
          <IconButton
            icon="refresh"
            label={t('Refine: use the enhanced prompt as the new input')}
            size="sm"
            variant="ghost"
            onPress={() => {
              put(draft, output)
              put(result, '')
            }}
          />
          <IconButton icon="delete" label={t('Clear')} size="sm" variant="ghost" onPress={() => put(result, '')} />
        </Row>
      </Row>
      <Textarea label={t('Enhanced prompt')} labelHidden rows={10} value={output} onChange={(value) => put(result, value)} onSubmit={(value) => void send(value)} />
      <RunInfo />
      <Row gap="xs" wrap>
        <TargetPicker />
        <Button variant="solid" icon="play" onPress={() => void send(output)} disabled={!read(target) || working !== null}>
          {t('Send')}
        </Button>
      </Row>
    </Box>
  )
}

export function EnhanceTab() {
  const working = read(busy)
  const text = read(draft)
  const output = read(result)
  const view = read(models)
  const profiles = read(enabledProfiles)
  const noModel = view !== null && profiles.length === 0
  const allKeyless = profiles.length > 0 && profiles.every((p) => p.keySource === 'none')
  return (
    <Stack gap="md">
      {noModel || allKeyless ? (
        <Callout tone="warning" title={noModel ? t('No model yet') : t('No API key yet')}>
          <Row gap="xs" justify="between" wrap>
            <Text size="sm">{t('Add one in the Models tab.')}</Text>
            <Button size="sm" variant="outline" icon="agent" onPress={() => set(tab, 'models')}>
              {t('Open Models')}
            </Button>
          </Row>
        </Callout>
      ) : null}
      <Box gap="sm" padding="sm" border radius="lg">
        <Textarea
          label={t('Your prompt')}
          labelHidden
          placeholder={t('Describe what you want the agent to do…')}
          rows={4}
          value={text}
          onChange={(value) => put(draft, value)}
          onSubmit={() => void enhanceNow()}
        />
        <Row gap="xs" justify="between" wrap>
          <ComposerModelPicker />
          <Row gap="xs">
            <IconButton
              icon="upload"
              label={read(images).length > 0 ? t('Attached images: {count}', { count: read(images).length }) : t('Attach images')}
              variant={read(imagesOpen) || read(images).length > 0 ? 'outline' : 'ghost'}
              onPress={() => update(imagesOpen, (open) => !open)}
            />
            <IconButton
              icon="bug"
              label={t('Fix an error from a terminal')}
              variant={read(fixOpen) ? 'outline' : 'ghost'}
              onPress={() => update(fixOpen, (open) => !open)}
            />
            <IconButton
              icon="filter"
              label={`${t('Options')}: ${optionsSummary()}`}
              variant={read(optionsOpen) ? 'outline' : 'ghost'}
              onPress={() => update(optionsOpen, (open) => !open)}
            />
            <IconButton
              icon="search"
              label={working === 'preview' ? t('Gathering…') : t('Preview context')}
              variant="ghost"
              onPress={() => void previewContext()}
              disabled={working !== null}
            />
            {working === 'enhance' ? (
              <Button variant="outline" icon="stop" onPress={cancel}>
                {t('Cancel')}
              </Button>
            ) : (
              <Button variant="solid" icon="lightbulb" tooltip={t('Ctrl+Enter (⌘Enter on macOS)')} onPress={() => void enhanceNow()} disabled={!text.trim() || working !== null}>
                {t('Enhance')}
              </Button>
            )}
          </Row>
        </Row>
        <ImagesBox />
        <PromptOptions />
        <FixErrorBox />
      </Box>
      <RunCard />
      <NoticeBar />
      <ContextPanel />
      {output ? (
        <ResultCard output={output} />
      ) : working === 'enhance' ? null : (
        <Row gap="xs" justify="between" wrap>
          <Text muted size="xs">
            {t('Nothing reaches the agent until you click Send.')}
          </Text>
          {text.trim() && read(target) ? (
            <Button variant="ghost" size="sm" icon="play" onPress={() => void send(text)} disabled={working !== null}>
              {t('Send as is')}
            </Button>
          ) : null}
        </Row>
      )}
    </Stack>
  )
}
