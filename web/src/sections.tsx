// History, Models, Rules and Settings (privacy) sections of the web panel: the panel's state and
// actions (src/panel/*), drawn with shadcn/ReUI.
import { useState } from 'react'
import { read, set, update } from 'orca'
import { ArrowDownIcon, ArrowUpIcon, RotateCcwIcon, CheckIcon, CopyIcon, EllipsisVerticalIcon, ExternalLinkIcon, PencilIcon, PlugZapIcon, PlusIcon, RefreshCwIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { currentLanguage, t } from '../../src/i18n.ts'
import { presetById, type ProfileView } from '../../src/presets.ts'
import { isStyle, STYLE_LABELS } from '../../src/prompts.ts'
import { allStructures, BUILT_IN_STRUCTURES, MAX_RULES, MAX_STRUCTURES, ruleApplies, scopeName } from '../../src/rules.ts'
import {
  busy,
  catalogLoading,
  catalogs,
  consents,
  CLI_DEFAULT,
  confirmClearHistory,
  confirmWipe,
  customModel,
  CUSTOM_MODEL,
  dataSummary,
  defaults,
  detected,
  feedbackOff,
  filteredHistory,
  form,
  history,
  historyFilter,
  HISTORY_PAGE,
  historyShown,
  models,
  privacy,
  projectName,
  ruleDraft,
  ruleScope,
  structureDraft,
  tab,
  toModel,
  workspaceName,
  type Form
} from '../../src/panel/state.ts'
import {
  addDetected,
  addRule,
  addStructure,
  applyPreset,
  clearData,
  confirmSwitch,
  turnSwitchOff,
  clearHistory,
  copy,
  formCatalogInput,
  loadCatalog,
  modelAction,
  openForm,
  openIssues,
  patchForm,
  removeEntry,
  removeStructure,
  reuse,
  saveForm,
  saveRules,
  setFeedbackNotes,
  setRoles,
  setSetting,
  switchModel,
  testProfile,
  toggleProfile
} from '../../src/panel/actions.ts'
import { AUTO_MODE_HINTS, DISCLOSURES, FEEDBACK_EVERY_DAYS, hookChoice, hookModels, KEY_LABEL, maxTokenChoices, modelOptions, PRIVACY_ROWS, rulesConfig } from '../../src/panel/view.ts'
import { NEEDS_CONSENT, OTHER_AGENTS_LIMITS, type PrivacyKey } from '../../src/privacy.ts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Field, Group, Hint, IconAction, Pick, Row, Section, Segmented } from './common'
import { WorkspacePicker } from './enhance'

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  const format = new Intl.RelativeTimeFormat(currentLanguage(), { numeric: 'auto' })
  if (minutes < 60) return format.format(-minutes, 'minute')
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), 'hour')
  return format.format(-Math.round(minutes / 1440), 'day')
}

// ---------------------------------------------------------------- History

export function HistorySection() {
  const all = read(history)
  const list = read(filteredHistory)
  const shown = read(historyShown)
  if (all.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-1 py-10 text-center">
        <p className="text-foreground font-medium">{t('No history yet')}</p>
        <p className="text-sm">{t('Enhanced prompts show up here.')}</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <Input type="search" aria-label={t('Search history')} placeholder={t('Search history')} value={read(historyFilter)} onChange={(event) => set(historyFilter, event.target.value)} className="h-8" />
      <div className="flex flex-col gap-1.5">
        {list.slice(0, shown).map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1 rounded-lg border p-2">
            <p className="truncate text-sm font-medium">{entry.original.split('\n')[0].slice(0, 160)}</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground truncate text-xs">
                {`${t(STYLE_LABELS[isStyle(entry.style) ? entry.style : 'balanced'])} · ${entry.model}${entry.source === 'hook' ? ` · ${t('auto')}` : ''} · ${ago(entry.at)}`}
              </span>
              <div className="flex shrink-0">
                <IconAction label={t('Open in Enhance tab')} onClick={() => reuse(entry)}>
                  <PencilIcon />
                </IconAction>
                <IconAction label={t('Copy enhanced prompt')} onClick={() => void copy(entry.enhanced)}>
                  <CopyIcon />
                </IconAction>
                <IconAction label={t('Delete')} onClick={() => void removeEntry(entry.id)}>
                  <Trash2Icon />
                </IconAction>
              </div>
            </div>
          </div>
        ))}
      </div>
      {list.length > shown ? (
        <Button variant="ghost" size="sm" onClick={() => update(historyShown, (count: number) => count + HISTORY_PAGE)}>
          {t('Show more')}
        </Button>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">{t('{shown} of {total}', { shown: Math.min(shown, list.length), total: all.length })}</span>
        <Button
          size="sm"
          variant={read(confirmClearHistory) ? 'destructive' : 'ghost'}
          onClick={() => (read(confirmClearHistory) ? void clearHistory() : set(confirmClearHistory, true))}
        >
          <Trash2Icon />
          {read(confirmClearHistory) ? t('Press again to clear history') : t('Clear history')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Models

function FormModelPicker({ current }: { current: Form }) {
  const catalog = read(catalogs).form
  const loading = read(catalogLoading).form === true
  const cli = current.provider === 'cli'
  const options = modelOptions(catalog, current.model)
  const inList = options.some((option) => option.value === current.model)
  const typing = read(customModel) || (current.model !== '' && !inList)
  const label = cli ? t('Model (optional)') : t('Model')
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        {options.length > 0 ? (
          <Pick
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
          <Input className="h-8" placeholder={presetById(current.preset).model || (cli ? t('CLI default') : 'model-id')} value={current.model} onChange={(event) => patchForm({ model: event.target.value })} />
        )}
        <IconAction label={t('Refresh model list')} disabled={loading} onClick={() => void loadCatalog('form', formCatalogInput(current), true)}>
          {loading ? <Spinner /> : <RefreshCwIcon />}
        </IconAction>
      </div>
      {options.length > 0 && typing ? <Input className="h-8" aria-label={t('Model id')} placeholder="model-id" value={current.model} onChange={(event) => patchForm({ model: event.target.value })} /> : null}
      <span className="text-muted-foreground text-xs">
        {loading
          ? t('Loading the model list…')
          : catalog?.error
            ? t('Could not load the list ({error}). Type the model id.', { error: catalog.error })
            : catalog && catalog.models.length > 0
              ? t('{count} models from {source}, refreshed daily.', { count: catalog.models.length, source: catalog.source })
              : cli
                ? t('Uses the model set in the CLI itself.')
                : t('Add the API key to list the models.')}
      </span>
    </Field>
  )
}

function ProfileForm() {
  const current = read(form)
  const view = read(models)
  if (!current || !view) return null
  const cli = current.provider === 'cli'
  const editing = Boolean(current.id)
  const preset = presetById(current.preset)
  const keyHint = editing ? t('Leave empty to keep the saved key') : preset.env ? t('Or set {env}', { env: preset.env }) : t('Not needed for local servers')
  const invalid = !current.name.trim() || (cli ? current.preset === 'custom-cli' && !current.command?.trim() : !(current.baseUrl.trim() || preset.baseUrl))
  return (
    <div className="border-primary/40 flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm font-semibold">{editing ? t('Edit {name}', { name: current.name }) : t('Add a model')}</p>
      <Field label={t('Preset')}>
        <Pick label={t('Preset')} value={current.preset} options={view.presets.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={applyPreset} />
      </Field>
      <Field label={t('Name')}>
        <Input className="h-8" value={current.name} onChange={(event) => patchForm({ name: event.target.value })} />
      </Field>
      {current.preset === 'custom' ? (
        <Field label={t('API format')}>
          <Pick
            label={t('API format')}
            value={current.provider}
            options={[
              { value: 'openai', label: 'OpenAI-compatible (/chat/completions)' },
              { value: 'anthropic', label: 'Anthropic (/v1/messages)' }
            ]}
            onChange={(value) => patchForm({ provider: value === 'anthropic' ? 'anthropic' : 'openai' })}
          />
        </Field>
      ) : null}
      {cli ? (
        <>
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            {t('Uses your subscription')}
            <Hint text={t('Runs the CLI already signed in on this machine, so it uses your subscription instead of an API key. Slower than an API (a few seconds per call), so it is skipped by auto-enhance.')} />
          </div>
          <Field label={t('Command')}>
            <Input className="h-8" placeholder={current.preset === 'custom-cli' ? 'my-llm' : t('Found on PATH automatically; or a full path')} value={current.command ?? ''} onChange={(event) => patchForm({ command: event.target.value })} />
          </Field>
          {current.preset === 'custom-cli' ? (
            <Field label={t('Arguments')}>
              <Input className="h-8" placeholder="run --quiet" value={current.args ?? ''} onChange={(event) => patchForm({ args: event.target.value })} />
            </Field>
          ) : null}
        </>
      ) : (
        <Field label={t('Base URL')}>
          <Input className="h-8" placeholder={preset.baseUrl || 'https://…'} value={current.baseUrl} onChange={(event) => patchForm({ baseUrl: event.target.value })} />
        </Field>
      )}
      <FormModelPicker current={current} />
      {cli ? null : (
        <>
          <Field label={t('API key')}>
            <Input className="h-8" type="password" placeholder={keyHint} value={current.apiKey} onChange={(event) => patchForm({ apiKey: event.target.value })} />
          </Field>
          <Field label={t('Max tokens')}>
            <Pick
              label={t('Max tokens')}
              value={String(current.maxTokens)}
              options={maxTokenChoices(current.maxTokens).map((value) => ({ value: String(value), label: t('{value} tokens', { value }) }))}
              onChange={(value) => patchForm({ maxTokens: Number(value) })}
            />
          </Field>
        </>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => void saveForm()} disabled={invalid || read(busy) === 'save'}>
          <CheckIcon />
          {t('Save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => set(form, null)}>
          {t('Cancel')}
        </Button>
      </div>
    </div>
  )
}

function ProfileCard({ profile, index, count, fromEnv }: { profile: ProfileView; index: number; count: number; fromEnv: boolean }) {
  const where = profile.provider === 'cli' ? `${presetById(profile.preset).label.replace(/ \(.*\)$/, '')} CLI` : profile.effectiveBaseUrl
  const listed = modelOptions(read(catalogs)[profile.id], profile.effectiveModel)
  const options = [...(profile.provider === 'cli' ? [{ value: CLI_DEFAULT, label: t('CLI default') }] : []), ...listed]
  const testing = read(busy) === 'test'
  return (
    <div className={cn('bg-card flex flex-col gap-2 rounded-xl border p-2.5', !profile.enabled && 'bg-muted/40')}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className={cn('flex items-center gap-1.5 text-sm font-medium', !profile.enabled && 'text-muted-foreground')}>
            <span className="text-muted-foreground text-xs tabular-nums">{`#${index + 1}`}</span>
            <span className="truncate">{profile.name}</span>
          </div>
          <div className={cn('truncate text-xs', profile.keySource === 'none' ? 'text-warning-foreground' : 'text-muted-foreground')}>
            {`${t(KEY_LABEL[profile.keySource])} · ${where}`}
          </div>
        </div>
        {fromEnv ? null : <Switch checked={profile.enabled} aria-label={profile.enabled ? t('Disable') : t('Enable')} onCheckedChange={(enabled) => void toggleProfile(profile, enabled)} />}
        <IconAction label={`${t('Test')} · ${where}`} onClick={() => void testProfile(profile.id)} disabled={testing}>
          {testing ? <Spinner /> : <PlugZapIcon />}
        </IconAction>
        {fromEnv ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-7" aria-label={t('More')}>
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openForm(profile)}>
                  <Settings2Icon />
                  {t('Edit')}
                </DropdownMenuItem>
                {count > 1 ? (
                  <>
                    <DropdownMenuItem disabled={index === 0} onSelect={() => void modelAction({ move: profile.id, to: index - 1 })}>
                      <ArrowUpIcon />
                      {t('Move up')}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === count - 1} onSelect={() => void modelAction({ move: profile.id, to: index + 1 })}>
                      <ArrowDownIcon />
                      {t('Move down')}
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void modelAction({ remove: profile.id })}>
                  <Trash2Icon />
                  {t('Delete')}
                </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 shrink-0 text-xs">{t('Model')}</span>
        {fromEnv ? (
          <span className="truncate text-xs">{profile.effectiveModel || t('CLI default')}</span>
        ) : (
          <Pick label={t('Model')} value={profile.effectiveModel || CLI_DEFAULT} options={options} onChange={(value) => void switchModel(profile, toModel(value))} className="h-7" />
        )}
      </div>
    </div>
  )
}

export function ModelsSection() {
  const view = read(models)
  const prefs = read(defaults)
  if (!view) return <Spinner className="mx-auto my-8" />
  const available = read(detected).filter((entry) => !entry.added)
  const roleOptions = [
    { value: 'chain', label: t('Same as the chain') },
    ...view.profiles.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.effectiveModel || t('CLI default')}` }))
  ]
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('Your models')} hint={t('Models are tried top to bottom. Disabled models are skipped.')}>
        {view.fromEnv && view.profiles.length > 0 ? (
          <Alert>
            <AlertTitle>{t('Using API keys from your environment')}</AlertTitle>
            <AlertDescription>{t('Add a model below to customize; then only your saved models are used.')}</AlertDescription>
          </Alert>
        ) : null}
        {view.profiles.length === 0 && !read(form) ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
            <p className="text-foreground font-medium">{t('No models yet')}</p>
            <p>{t('Use a subscription CLI above, or add OpenAI, Anthropic, OpenRouter, Gemini, Groq, DeepSeek, Mistral, Ollama, LM Studio or any OpenAI-compatible endpoint.')}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          {view.profiles.map((profile, index) => (
            <ProfileCard key={profile.id} profile={profile} index={index} count={view.profiles.length} fromEnv={view.fromEnv} />
          ))}
        </div>
        {read(form) ? (
          <ProfileForm />
        ) : (
          <Button variant="outline" size="sm" className="self-start" onClick={() => openForm()}>
            <PlusIcon />
            {t('Add model')}
          </Button>
        )}
      </Section>
      <Group title={t('Fallback')}>
        <Row
          title={t('Fallback to the next model when one fails')}
          description={t('Models are tried top to bottom. Disabled models are skipped.')}
          control={
            <Switch
              checked={prefs.fallbackEnabled}
              onCheckedChange={(value) => {
                // On: any error falls back (a bad key or an unknown model too), with no second choice to make.
                if (value && prefs.fallbackOn !== 'any') void setSetting('fallbackOn', 'any')
                void setSetting('fallbackEnabled', value)
              }}
            />
          }
        />
      </Group>
      {view.profiles.length > 1 && !view.fromEnv ? (
        <Group title={t('Max context level')}>
          <Row title={t('File picker model (Max context level)')}>
            <Pick
              label={t('File picker model (Max context level)')}
              value={view.selectorProfileId ?? 'chain'}
              options={roleOptions}
              onChange={(value) => void setRoles({ selectorProfileId: value === 'chain' ? null : value })}
            />
          </Row>
        </Group>
      ) : null}
      {available.length > 0 ? (
        <Group title={t('Use your subscription, no API key')}>
          {available.map((entry) => (
            <Row
              key={entry.preset}
              title={entry.label.replace(/ \(.*\)$/, '')}
              description={<span className="block truncate">{entry.path}</span>}
              control={
                <Button size="sm" variant="outline" title={t('Found on this machine. Uses the account the CLI is signed in with.')} onClick={() => void addDetected(entry.preset, entry.path)}>
                  <PlusIcon />
                  {t('Add')}
                </Button>
              }
            />
          ))}
        </Group>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- Rules

/** Adds a rule for this project only (for every project while it is not known which project this is). */
function addProjectRule(project: string | null): void {
  set(ruleScope, project ? 'workspace' : 'all')
  addRule()
}

function RuleComposer({ project, full }: { project: string | null; full: boolean }) {
  return (
    <Row>
      <Textarea
        rows={2}
        aria-label={t('New rule')}
        placeholder={t('e.g. Answer in Vietnamese; keep code identifiers in English.')}
        value={read(ruleDraft)}
        onChange={(event) => set(ruleDraft, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            addProjectRule(project)
          }
        }}
        className="min-h-12 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground min-w-0 truncate text-xs">{project ? t('Only {name}', { name: project }) : t('Every project')}</span>
        <Button size="sm" onClick={() => addProjectRule(project)} disabled={!read(ruleDraft).trim() || full}>
          <PlusIcon />
          {t('Add rule')}
        </Button>
      </div>
    </Row>
  )
}

/** The structure form: a new structure, or (with an id) an edit of one, built-in ones included. */
function StructureForm({ id, onDone }: { id?: string; onDone: () => void }) {
  const draft = read(structureDraft)
  const full = !id && rulesConfig().structures.length >= MAX_STRUCTURES
  return (
    <Row>
      <Input className="h-8" aria-label={t('Structure name')} placeholder={t('e.g. My brief')} value={draft.name} onChange={(event) => set(structureDraft, { ...draft, name: event.target.value })} />
      <Textarea
        rows={4}
        aria-label={t('Headings, one per line')}
        placeholder={BUILT_IN_STRUCTURES[0].sections.slice(0, 4).map((section) => t(section)).join('\n')}
        value={draft.sections}
        onChange={(event) => set(structureDraft, { ...draft, sections: event.target.value })}
      />
      <p className="text-muted-foreground text-xs">{`${t('Headings, one per line')} · ${t('Written in any language; the rewriter translates them into the output language.')}`}</p>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            addStructure(id)
            onDone()
          }}
          disabled={!draft.name.trim() || !draft.sections.trim() || full}
        >
          <CheckIcon />
          {id ? t('Save') : t('Add structure')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t('Cancel')}
        </Button>
      </div>
    </Row>
  )
}

export function RulesSection() {
  const config = rulesConfig()
  const project = read(projectName)
  // The rules followed here: this project's, the ones for every project, and older ones kept under
  // the workspace's name. Other projects' rules stay hidden.
  const shownRules = config.rules.filter((rule) => ruleApplies(rule, { workspace: read(workspaceName), project }))
  // The structure being edited: 'new', an id, or none.
  const [editing, setEditing] = useState<string | null>(null)
  const startEditing = (value: string) => {
    if (value === 'new') set(structureDraft, { name: '', sections: '' })
    setEditing(value)
  }
  return (
    <div className="flex flex-col gap-4">
      {/* Not known which of several same-named projects this is: a new rule would be for every project. */}
      <WorkspacePicker />
      <Group
        title={t('Your rules')}
        hint={t('Followed in every enhanced prompt and by auto-enhance, on top of the style. A rule you add is for the project you are in.')}
      >
        {shownRules.length === 0 ? (
          <Row>
            <p className="text-muted-foreground text-sm">{t('No rules yet. Example: "Always tell the agent to run pnpm test before finishing."')}</p>
          </Row>
        ) : null}
        {shownRules.map((rule) => (
          <Row
            key={rule.id}
            className={cn(!rule.enabled && 'opacity-60')}
            title={<span className="font-normal break-words">{rule.text}</span>}
            description={rule.scope ? t('Only {name}', { name: scopeName(rule.scope) }) : t('everywhere')}
            control={
              <div className="flex items-center gap-1">
                <Switch
                  checked={rule.enabled}
                  aria-label={rule.enabled ? t('Disable') : t('Enable')}
                  onCheckedChange={(enabled) => saveRules((current) => ({ ...current, rules: current.rules.map((entry) => (entry.id === rule.id ? { ...entry, enabled } : entry)) }))}
                />
                <IconAction label={t('Delete')} onClick={() => saveRules((current) => ({ ...current, rules: current.rules.filter((entry) => entry.id !== rule.id) }))}>
                  <Trash2Icon />
                </IconAction>
              </div>
            }
          />
        ))}
        <RuleComposer project={project} full={config.rules.length >= MAX_RULES} />
      </Group>
      <Group
        title={t('Prompt structures')}
        hint={t("Pick one under Options in the composer: the prompt is written under these headings instead of the style's shape.")}
        action={
          editing ? null : (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => startEditing('new')} disabled={config.structures.length >= MAX_STRUCTURES}>
              <PlusIcon />
              {t('Add structure')}
            </Button>
          )
        }
      >
        {editing === 'new' ? <StructureForm onDone={() => setEditing(null)} /> : null}
        {allStructures(config).map(({ structure, builtIn, edited }) => {
          // An untouched built-in shows in the panel's language; an edited one as you wrote it.
          const translated = builtIn && !edited
          const name = translated ? t(structure.name) : structure.name
          const sections = structure.sections.map((section) => (translated ? t(section) : section))
          if (editing === structure.id) return <StructureForm key={structure.id} id={structure.id} onDone={() => setEditing(null)} />
          return (
            <Row
              key={structure.id}
              title={
                <span className="flex items-center gap-1.5">
                  {name}
                  {builtIn ? <Badge variant="outline">{edited ? t('edited') : t('built-in')}</Badge> : null}
                </span>
              }
              description={sections.join(' · ')}
              control={
                <div className="flex">
                  <IconAction
                    label={t('Edit')}
                    onClick={() => {
                      set(structureDraft, { name, sections: sections.join('\n') })
                      startEditing(structure.id)
                    }}
                  >
                    <PencilIcon />
                  </IconAction>
                  {builtIn ? (
                    edited ? (
                      <IconAction label={t('Restore the default')} onClick={() => removeStructure(structure.id)}>
                        <RotateCcwIcon />
                      </IconAction>
                    ) : null
                  ) : (
                    <IconAction label={t('Delete')} onClick={() => removeStructure(structure.id)}>
                      <Trash2Icon />
                    </IconAction>
                  )}
                </div>
              }
            />
          )
        })}
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------- Settings (privacy)

/** Choices offered for the amounts (a value set in Orca's Settings is added when it is not one of them). */
const AGENT_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8]
const LINE_CHOICES = [10, 20, 40, 80, 120, 200, 300]
const withValue = (choices: number[], value: number) => [...new Set([...choices, value])].sort((a, b) => a - b)

/** How many other agents and lines "Read other agents' sessions" reads; saved even while it is off. */
function OtherAgentsAmounts({ active }: { active: boolean }) {
  const { agents, lines } = read(defaults).otherAgents
  return (
    <span className="mt-2 flex flex-col gap-1.5">
      <span className="grid grid-cols-2 gap-2">
        <Field label={t('Agents read')}>
          <Pick
            label={t('Agents read')}
            value={String(agents)}
            options={withValue(AGENT_CHOICES, agents).map((value) => ({ value: String(value), label: t('{count} agents', { count: value }) }))}
            onChange={(value) => void setSetting(OTHER_AGENTS_LIMITS.agents.key, Number(value))}
          />
        </Field>
        <Field label={t('Lines per agent')}>
          <Pick
            label={t('Lines per agent')}
            value={String(lines)}
            options={withValue(LINE_CHOICES, lines).map((value) => ({ value: String(value), label: t('{count} lines', { count: value }) }))}
            onChange={(value) => void setSetting(OTHER_AGENTS_LIMITS.lines.key, Number(value))}
          />
        </Field>
      </span>
      {active ? null : <span className="text-muted-foreground">{t('Used only while this switch is on and confirmed.')}</span>}
    </span>
  )
}

/** Before a switch that needs it turns on: everything it allows, in plain words, and Turn on / Cancel. */
function ConsentDialog({ keyName, onClose }: { keyName: PrivacyKey | null; onClose: () => void }) {
  const row = PRIVACY_ROWS.find((entry) => entry.key === keyName)
  const points = keyName ? (DISCLOSURES[keyName] ?? []) : []
  return (
    <Dialog open={keyName !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[85vh] max-w-[calc(100vw-24px)] flex-col gap-3 p-4">
        <DialogHeader>
          <DialogTitle>{row ? t('Turn on "{name}"?', { name: t(row.label) }) : ''}</DialogTitle>
          <DialogDescription>{t('Read what this allows. Nothing is hidden: this is everything it does.')}</DialogDescription>
        </DialogHeader>
        {/* Padding, not a margin: the list scrolls, and a scrolling box cuts off bullets drawn outside it. */}
        <ul className="list-disc space-y-1.5 overflow-y-auto pl-5 text-sm leading-relaxed">
          {points.map((point) => (
            <li key={point}>{t(point)}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">{t('You can turn it off at any time here; turning it off also withdraws this confirmation.')}</p>
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (keyName) void confirmSwitch(keyName)
              onClose()
            }}
          >
            {t('I understand, turn it on')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsSection() {
  // ?ask=<switch> opens its confirmation at once in the dev server (pictures of the dialog).
  const [asking, setAsking] = useState<PrivacyKey | null>(import.meta.env.DEV ? (new URLSearchParams(location.search).get('ask') as PrivacyKey | null) : null)
  const flags = read(privacy)
  const data = read(dataSummary)
  const prefs = read(defaults)
  const view = read(models)
  const hookOptions = hookModels()
  return (
    <div className="flex flex-col gap-4">
      <Group title={t('Auto-enhance')} hint={t('Launch, task and orchestration prompts. Prompts you type yourself are never changed. The text for Rules is in Settings → Plugins → Enhance Prompt.')}>
        <Row>
          <Segmented
            label={t('Auto-enhance prompts Orca sends to agents')}
            value={prefs.autoEnhanceMode}
            options={[
              { value: 'off', label: t('Off') },
              { value: 'rules', label: t('Rules') },
              { value: 'ai', label: 'AI' }
            ]}
            onChange={(value) => void setSetting('autoEnhanceMode', value)}
          />
          <p className="text-muted-foreground text-xs">{t(AUTO_MODE_HINTS[prefs.autoEnhanceMode] ?? AUTO_MODE_HINTS.off)}</p>
        </Row>
        {view && prefs.autoEnhanceMode === 'ai' && hookOptions.length === 0 ? (
          <Row
            title={t('Auto-enhance (AI) has no model to use')}
            description={t('It needs an enabled API model: subscription CLIs take too long for its 2 s limit. Add one in Models, or use Rules.')}
            control={
              <Button size="sm" variant="outline" onClick={() => set(tab, 'models')}>
                {t('Open Models')}
              </Button>
            }
          />
        ) : null}
        {view && hookOptions.length > 1 && !view.fromEnv && prefs.autoEnhanceMode === 'ai' ? (
          <Row title={t('Auto-enhance hook model (needs to answer in under 2 s)')}>
            <Pick
              label={t('Auto-enhance hook model (needs to answer in under 2 s)')}
              value={hookChoice()}
              options={[{ value: 'chain', label: t('Same as the chain') }, ...hookOptions.map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.effectiveModel}` }))]}
              onChange={(value) => void setRoles({ hookProfileId: value === 'chain' ? null : value })}
            />
          </Row>
        ) : null}
      </Group>
      <Group title={t('What it may use')} hint={t('Orca asks once for everything this plugin may do. These switches decide what it actually uses; the plugin checks them every time.')}>
        {PRIVACY_ROWS.map((row) => {
          const needs = NEEDS_CONSENT.has(row.key)
          const on = flags[row.key] === true
          // On in Orca's Settings but never confirmed here: the worker keeps it off until confirmed.
          const waiting = needs && on && !read(consents).includes(row.key)
          return (
            <Row
              key={row.key}
              title={
                <span className="flex flex-wrap items-center gap-1.5">
                  {t(row.label)}
                  {needs ? <Badge variant="outline">{t('asks to confirm')}</Badge> : null}
                </span>
              }
              description={
                <>
                  {t(row.hint)}
                  {row.key === 'allowOtherAgents' ? <OtherAgentsAmounts active={on && !waiting && flags.allowTerminalRead !== false} /> : null}
                  {waiting ? (
                    <span className="text-warning-foreground mt-1 flex items-center gap-2">
                      {t('Turned on in Settings, but not confirmed here yet: still off.')}
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setAsking(row.key)}>
                        {t('Read and confirm')}
                      </Button>
                    </span>
                  ) : null}
                </>
              }
              control={
                <Switch
                  checked={on && !waiting}
                  aria-label={t(row.label)}
                  onCheckedChange={(value) => {
                    if (value && needs) {
                      setAsking(row.key)
                      return
                    }
                    update(privacy, (map: Record<string, boolean>) => ({ ...map, [row.key]: value }))
                    void (value ? setSetting(row.key, true) : turnSwitchOff(row.key))
                  }}
                />
              }
            />
          )
        })}
      </Group>
      <Group title={t('Notifications')}>
        <Row
          title={t('Notify when a long enhance finishes')}
          description={t('A desktop notification when a run takes more than 8 s. It names the model and the time, never your prompt.')}
          control={<Switch checked={prefs.notifyWhenDone} aria-label={t('Notify when a long enhance finishes')} onCheckedChange={(value) => void setSetting('notifyWhenDone', value)} />}
        />
      </Group>
      <ConsentDialog keyName={asking} onClose={() => setAsking(null)} />
      <Group title={t('Stored on this machine')} hint={t('Nothing is sent anywhere except your prompt and the context you allow, to the model you run. No tracking or analytics.')}>
        {data ? (
          [
            [t('History'), data.history, () => void clearData('history'), t('Clear history')],
            [t('Saved models'), data.profiles, null, ''],
            [t('API keys (encrypted by Orca)'), data.keys, null, ''],
            [t('Cached model lists'), data.catalogs, () => void clearData('catalogs'), t('Clear model lists')]
          ].map(([label, value, clear, clearLabel]) => (
            <Row
              key={String(label)}
              title={<span className="font-normal">{String(label)}</span>}
              control={
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground text-sm tabular-nums">{String(value)}</span>
                  {typeof clear === 'function' ? (
                    <IconAction label={String(clearLabel)} onClick={clear}>
                      <Trash2Icon />
                    </IconAction>
                  ) : null}
                </div>
              }
            />
          ))
        ) : (
          <Row>
            <Spinner />
          </Row>
        )}
        <Row
          control={
            <Button size="sm" variant={read(confirmWipe) ? 'destructive' : 'outline'} onClick={() => (read(confirmWipe) ? void clearData('all') : set(confirmWipe, true))}>
              {read(confirmWipe) ? t('Press again to delete everything') : t('Delete everything')}
            </Button>
          }
        />
      </Group>
      <Group title={t('Feedback')}>
        <Row
          description={t('Found a bug, or something that could be better? Open an issue on GitHub: it is how the plugin gets fixed and improved.')}
          control={
            <IconAction label={t('Open an issue on GitHub')} variant="outline" onClick={() => void openIssues()}>
              <ExternalLinkIcon />
            </IconAction>
          }
        />
        <Row
          title={t('Ask for feedback now and then')}
          description={t('A short note under the enhanced prompt invites your ideas, at most once in {days} days. Off: it never shows.', { days: FEEDBACK_EVERY_DAYS })}
          control={<Switch checked={!read(feedbackOff)} aria-label={t('Ask for feedback now and then')} onCheckedChange={setFeedbackNotes} />}
        />
      </Group>
    </div>
  )
}
