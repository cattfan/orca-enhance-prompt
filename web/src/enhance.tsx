// The Enhance section of the web panel: the composer (paste, drop or attach files; Enter enhances),
// the run's progress, the context sent, and the enhanced prompt with Send.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { read, set, settings, update } from 'orca'
import {
  CopyIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  PaperclipIcon,
  ArrowUpToLineIcon,
  BotIcon,
  ExternalLinkIcon,
  LightbulbIcon,
  RotateCcwIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SquareIcon,
  Trash2Icon,
  XIcon
} from 'lucide-react'
import { t } from '../../src/i18n.ts'
import { totalPercent, stepPercent } from '../../src/progress.ts'
import {
  busy,
  contextNotes,
  contextShown,
  draft,
  effectiveEnter,
  effectiveLevel,
  effectiveStyle,
  excluded,
  feedbackShown,
  files,
  lastRun,
  level,
  optionsOpen,
  outputChoice,
  pressEnter,
  put,
  result,
  run,
  say,
  structureChoice,
  style,
  tab,
  target,
  targets,
  tick,
  workspaceChoices,
  workspaceKey,
  workspaceName,
  detected
} from '../../src/panel/state.ts'
import {
  addDetected,
  allowed,
  launchAgent,
  openFile,
  cancel,
  closeFeedback,
  copy,
  enhanceNow,
  enhanceOrSend,
  pickWorkspace,
  previewContext,
  refreshTargets,
  removeFile,
  send,
  sendFeedback,
  setSetting,
  stopFeedback,
  toggleItem
} from '../../src/panel/actions.ts'
import {
  contextKind,
  currentModelValue,
  itemWhy,
  levelOptions,
  modelMenu,
  modelWarning,
  targetLabel,
  optionsSummary,
  outputOptions,
  pickModel,
  runSeconds,
  seconds,
  STEP_GLYPH,
  STEP_LABELS,
  stepShare,
  stepText,
  structureOptions,
  structureValue,
  styleOptions
} from '../../src/panel/view.ts'
import { projectLabel } from '../../src/workspaces.ts'
import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { attachFiles, filesOf, MAX_FILES, previews, uploadingNames } from './attach'
import { Field, IconAction, megabytes, Pick } from './common'

/** Attached files: a thumbnail for images, an icon for the rest, each with its size and a remove button. */
function Attachments() {
  const list = read(files)
  const pending = uploadingNames()
  if (list.length === 0 && pending.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((file) => (
        <div key={file.path} className="bg-muted/60 group relative flex max-w-44 items-center gap-1.5 rounded-md border py-1 pr-6 pl-1" title={file.path}>
          {previews.get(file.path) ? (
            <img src={previews.get(file.path)} alt="" className="size-7 shrink-0 rounded object-cover" />
          ) : (
            <span className="bg-background grid size-7 shrink-0 place-items-center rounded">
              <FileTextIcon className="text-muted-foreground size-4" />
            </span>
          )}
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs font-medium">{file.name}</span>
            <span className="text-muted-foreground block text-[10px]">{megabytes(file.bytes)}</span>
          </span>
          <button
            type="button"
            aria-label={t('Remove {name}', { name: file.name })}
            onClick={() => removeFile(file.path)}
            className="text-muted-foreground hover:text-foreground absolute top-1 right-1 rounded p-0.5"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      {pending.map((name) => (
        <div key={name} className="text-muted-foreground flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs">
          <Spinner className="size-3" />
          <span className="max-w-32 truncate">{name}</span>
        </div>
      ))}
    </div>
  )
}

/** The model menu: every model of every enabled profile, plus Auto. */
function ModelPicker() {
  const options = modelMenu()
  const value = currentModelValue()
  return (
    <Pick
      label={t('Model')}
      value={options.some((option) => option.value === value) ? value : 'auto'}
      options={options}
      onChange={pickModel}
      className="h-7 border-transparent bg-transparent px-2 shadow-none hover:bg-accent dark:bg-transparent"
    />
  )
}

/** The composer: text, attachments, then model · options · preview on the left and attach + Enter on the right. */
function Composer({ refresh }: { refresh: () => void }) {
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const working = read(busy)
  const text = read(draft)
  const attachedCount = read(files).length + uploadingNames().length

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter enhances (the button shows the Enter key); Shift+Enter is a new line. Ctrl+Enter (⌘ on
    // a Mac) sends the result once it is there and still the one for this text, so a prompt goes
    // from idea to terminal without the mouse, and never unread.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void (event.ctrlKey || event.metaKey ? enhanceOrSend() : enhanceNow())
    }
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = filesOf(event.clipboardData)
    if (pasted.length === 0) return
    event.preventDefault()
    void attachFiles(pasted, refresh)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void attachFiles(filesOf(event.dataTransfer), refresh)
  }

  return (
    <div
      className={cn('bg-card relative flex flex-col gap-2 rounded-xl border p-2 shadow-xs transition-colors focus-within:border-ring', dragging && 'border-primary bg-primary/5')}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Attachments />
      <Textarea
        aria-label={t('Your prompt')}
        placeholder={t('Describe what you want the agent to do…')}
        value={text}
        rows={3}
        onChange={(event) => put(draft, event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="max-h-80 min-h-16 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      {dragging ? (
        <div className="border-primary text-primary pointer-events-none absolute inset-1 grid place-items-center rounded-lg border-2 border-dashed text-sm font-medium">
          {t('Drop files to attach')}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <ModelPicker />
          <IconAction label={`${t('Options')}: ${optionsSummary()}`} variant={read(optionsOpen) ? 'secondary' : 'ghost'} onClick={() => update(optionsOpen, (open) => !open)}>
            <SlidersHorizontalIcon />
          </IconAction>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void attachFiles(Array.from(event.target.files ?? []), refresh)
              event.target.value = ''
            }}
          />
          <IconAction label={t('Attach files')} onClick={() => picker.current?.click()} disabled={attachedCount >= MAX_FILES}>
            <PaperclipIcon />
          </IconAction>
          {working === 'enhance' ? (
            <IconAction label={t('Cancel')} variant="outline" onClick={cancel}>
              <SquareIcon className="fill-current" />
            </IconAction>
          ) : (
            <IconAction label={t('Enhance (Enter) · Shift+Enter for a new line')} variant="default" onClick={() => void enhanceNow()} disabled={!text.trim() || working !== null}>
              <CornerDownLeftIcon />
            </IconAction>
          )}
        </div>
      </div>
      <PromptOptions />
    </div>
  )
}

/**
 * The "Custom only" style's instructions (the `customInstructions` setting, also in Orca's Settings):
 * the prompt follows them instead of a built-in shape. Saved when the box loses focus.
 */
function CustomInstructions() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    void settings.get('customInstructions').then((value) => setText(typeof value === 'string' ? value : ''))
  }, [])
  if (text === null) return null
  return (
    <Field label={t('Custom instructions')}>
      <Textarea
        rows={3}
        value={text}
        placeholder={t('e.g. Write the prompt as a numbered checklist; always ask the agent to run the tests.')}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => void setSetting('customInstructions', text.slice(0, 4000))}
        className="bg-background"
      />
    </Field>
  )
}

/** Style, context, output language and structure, under the composer when opened, and the context sent. */
function PromptOptions() {
  if (!read(optionsOpen)) return null
  return (
    <div className="bg-muted/50 flex flex-col gap-2 rounded-lg border p-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('Style')}>
          <Pick label={t('Style')} value={read(effectiveStyle)} options={styleOptions()} onChange={(value) => set(style, value)} />
        </Field>
        <Field label={t('Context')}>
          <Pick label={t('Context')} value={read(effectiveLevel)} options={levelOptions()} onChange={(value) => set(level, value)} />
        </Field>
        <Field label={t('Output language')}>
          <Pick label={t('Output language')} value={read(outputChoice)} options={outputOptions()} onChange={(value) => set(outputChoice, value)} />
        </Field>
        <Field label={t('Structure')}>
          <Pick label={t('Structure')} value={structureValue()} options={structureOptions()} onChange={(value) => set(structureChoice, value === 'style' ? '' : value)} />
        </Field>
      </div>
      {read(effectiveStyle) === 'custom' ? <CustomInstructions /> : null}
      <ContextList />
    </div>
  )
}

/** Live progress of the current run, then how it ended when it did not end well. */
function RunCard() {
  const current = read(run)
  if (!current || current.status === 'done') return null
  const running = current.status === 'running'
  if (current.workspace && current.workspace.key !== read(workspaceKey)) {
    if (!running) return null
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner />
        <span className="truncate">{t('Writing the prompt for {name}…', { name: current.workspace.name ?? '?' })}</span>
      </div>
    )
  }
  const steps = current.steps
  const now = read(tick)
  const total = running ? totalPercent(steps, now) : (current.endPercent ?? totalPercent(steps, now))
  const active = steps.find((entry) => entry.status === 'running')
  const finished = steps.filter((entry) => entry.status === 'done' || entry.status === 'skipped')
  const next = steps.find((entry) => entry.status === 'pending')
  const idle = finished.length === 0 ? t('Starting…') : next ? stepText(next) : t('Finishing…')
  const title = running ? (active ? stepText(active) : idle) : current.status === 'cancelled' ? t('Cancelled') : t('Enhance failed')
  const failed = current.status === 'error'
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border p-2.5', failed && 'border-destructive/40')}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          {running ? <Spinner className="text-primary" /> : null}
          <span className="tabular-nums">{total}%</span>
          <span className={cn('truncate', failed && 'text-destructive')}>{title}</span>
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{runSeconds(current, now)}</span>
      </div>
      <Progress value={total} aria-label={t('Progress: {percent}%', { percent: total })} className="h-1.5" />
      {steps.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {steps.map((entry) => {
            const isRunning = entry.status === 'running'
            return (
              <li key={entry.key} className="flex flex-col gap-0.5">
                <div
                  className={cn(
                    'flex justify-between gap-2',
                    (entry.status === 'pending' || entry.status === 'skipped') && 'text-muted-foreground',
                    isRunning && 'text-primary',
                    entry.status === 'failed' && 'text-destructive'
                  )}
                >
                  <span className="truncate">{`${STEP_GLYPH[entry.status]}  ${stepText(entry)}`}</span>
                  <span className="tabular-nums">{stepShare(entry, now)}</span>
                </div>
                {isRunning ? <Progress value={stepPercent(entry, now) ?? 0} aria-label={t(STEP_LABELS[entry.key])} className="h-1" /> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {failed && current.error ? <p className="text-destructive text-xs">{current.error}</p> : null}
      {running ? null : (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void enhanceNow()}>
            <RotateCcwIcon />
            {t('Try again')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => set(run, null)}>
            {t('Dismiss')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The context sent with the prompt, listed in the options. Opening them gathers it once (no model
 * call); untick an item to leave it out.
 */
function ContextList() {
  const shown = read(contextShown)
  const notes = read(contextNotes)
  const working = read(busy)
  const empty = shown.length === 0 && notes.length === 0
  const ex = new Set(read(excluded))
  useEffect(() => {
    if (empty && read(busy) === null) void previewContext()
  }, [empty])
  if (empty) {
    return working === 'preview' ? (
      <div className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
        <Spinner className="size-3.5" />
        {t('Gathering…')}
      </div>
    ) : null
  }
  return (
    <div className="bg-background flex flex-col gap-1.5 rounded-lg border px-2.5 py-2">
      {shown.map((item) => (
        <div key={item.id} className="flex items-start gap-1">
          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
            <Checkbox checked={!ex.has(item.id)} onCheckedChange={(checked) => toggleItem(item.id, checked === true)} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block truncate text-sm">{item.title ? say(item.title) : item.label}</span>
              <span className="text-muted-foreground block text-xs">
                {t('{kind} · {chars} chars', { kind: contextKind(item.kind), chars: item.chars.toLocaleString() })}
                {itemWhy(item)}
              </span>
            </span>
          </label>
          {/* Outside the label: a press here must not tick or untick the item. */}
          {item.id.startsWith('file:') && allowed('allowOpenFiles') ? (
            <IconAction label={t('Open in Orca')} className="size-6 shrink-0" onClick={() => void openFile(item.id.slice('file:'.length))}>
              <ExternalLinkIcon />
            </IconAction>
          ) : null}
        </div>
      ))}
      {notes.map((note) => (
        <p key={JSON.stringify(note)} className="text-muted-foreground text-xs">
          {say(note)}
        </p>
      ))}
    </div>
  )
}

/** The terminal to send to; the list reloads each time it opens (and on Orca's workspace events). */
function TargetPicker() {
  const list = read(targets)
  return (
    <div className="min-w-0 flex-1">
      <Pick
        label={t('Send to')}
        value={read(target) ?? undefined}
        placeholder={list.length === 0 ? t('No terminals in this workspace') : t('Choose a terminal')}
        options={list.map((item) => ({ value: item.terminalId, label: targetLabel(item) }))}
        onChange={(value) => set(target, value)}
        onOpen={() => void refreshTargets()}
      />
    </div>
  )
}

function ResultCard({ output }: { output: string }) {
  const working = read(busy)
  const info = read(lastRun)
  const failed = info?.attempts.filter((attempt) => !attempt.ok) ?? []
  return (
    <div className="bg-card flex flex-col gap-2 rounded-xl border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{t('Enhanced prompt')}</span>
          {info ? <Badge variant="success-light">{`${t('Done')} · ${seconds(info.ms)}`}</Badge> : null}
        </div>
        <div className="flex">
          <IconAction label={t('Copy')} onClick={() => void copy(output)}>
            <CopyIcon />
          </IconAction>
          <IconAction
            label={t('Refine: use the enhanced prompt as the new input')}
            onClick={() => {
              put(draft, output)
              put(result, '')
            }}
          >
            <ArrowUpToLineIcon />
          </IconAction>
          <IconAction label={t('Clear')} onClick={() => put(result, '')}>
            <Trash2Icon />
          </IconAction>
        </div>
      </div>
      <Textarea
        aria-label={t('Enhanced prompt')}
        value={output}
        rows={10}
        onChange={(event) => put(result, event.target.value)}
        onKeyDown={(event) => {
          // Ctrl+Enter (⌘ on a Mac) sends what is in the box, edits included.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send(output)
          }
        }}
        className="max-h-[60vh] text-[13px]"
      />
      {failed.length > 0 ? (
        <p className="text-warning-foreground text-xs">
          {t('Fell back after: {list}', {
            list: failed.map((attempt) => `${attempt.name} (${attempt.errorText ? say(attempt.errorText) : (attempt.error ?? 'failed')})`).join(', ')
          })}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <TargetPicker />
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="text-muted-foreground hover:text-foreground flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1 text-xs">
              <Switch size="sm" checked={read(effectiveEnter)} onCheckedChange={(value) => set(pressEnter, value)} aria-label={t('Press Enter after sending')} />
              Enter
            </label>
          </TooltipTrigger>
          <TooltipContent>{t('Press Enter after sending')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={() => void send(output)} disabled={!read(target) || working !== null}>
              <SendIcon />
              {t('Send')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('Send to the terminal (Ctrl+Enter)')}</TooltipContent>
        </Tooltip>
      </div>
      {allowed('allowAgentLaunch') ? <NewAgent output={output} /> : null}
    </div>
  )
}

/** Agents a new session can start with: those running here, then the usual ones. */
function agentKinds(): string[] {
  const running = read(targets)
    .map((item) => item.agent)
    .filter((agent): agent is string => Boolean(agent))
  return [...new Set([...running, 'claude', 'codex', 'gemini'])]
}

/** Starts a new agent with the enhanced prompt (Privacy: Start new agents, confirmed). */
function NewAgent({ output }: { output: string }) {
  const kinds = agentKinds()
  const [kind, setKind] = useState(kinds[0])
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground shrink-0 text-xs">{t('Or start a new agent')}</span>
      <Pick label={t('Agent')} value={kind} options={kinds.map((value) => ({ value, label: value }))} onChange={setKind} className="h-7 w-28" />
      <Button size="sm" variant="outline" onClick={() => void launchAgent(kind, output)} disabled={read(busy) !== null}>
        <BotIcon />
        {t('Start')}
      </Button>
    </div>
  )
}

/**
 * Now and then, under a result: asks for ideas and feedback (src/panel/view.ts says when). Three
 * ways out: send some, close the note for now, or never be asked again (the switch in the settings).
 */
function FeedbackNote() {
  if (!read(feedbackShown)) return null
  return (
    <div className="bg-card flex items-start gap-2 rounded-xl border py-2 pr-1.5 pl-2.5">
      <LightbulbIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">{t('Got an idea, or something that could work better? Send your feedback: it is how the plugin improves.')}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => void sendFeedback()}>
            {t('Send feedback')}
          </Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={stopFeedback}>
            {t("Don't ask again")}
          </Button>
        </div>
      </div>
      <IconAction label={t('Close')} className="size-6 shrink-0" onClick={closeFeedback}>
        <XIcon />
      </IconAction>
    </div>
  )
}

/**
 * Several workspaces share this one's name and branch: the person picks its folder once. Shown above
 * the composer, and in the Rules section (a rule is kept for one project).
 */
export function WorkspacePicker() {
  const choices = read(workspaceChoices)
  if (choices.length === 0) return null
  return (
    <Alert variant="warning">
      <AlertTitle>{t('Which folder is this project?')}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{t('Several projects are named {name} on the same branch. Pick its folder so its files are read and its rules are followed.', { name: read(workspaceName) ?? '?' })}</span>
        <Pick
          label={t('Project folder')}
          value={undefined}
          placeholder={t('Choose a folder')}
          options={choices.map((choice) => ({ value: choice.id, label: projectLabel(choice) }))}
          onChange={(value) => void pickWorkspace(value)}
        />
      </AlertDescription>
    </Alert>
  )
}

export function EnhanceSection({ refresh }: { refresh: () => void }) {
  const output = read(result)
  const warning = modelWarning()
  // With no model yet, an agent CLI found on this machine is one press away: it runs on the
  // subscription the person already has, with no key to paste.
  const found = warning === 'no-model' ? read(detected).filter((entry) => !entry.added) : []
  return (
    <div className="flex flex-col gap-3">
      <WorkspacePicker />
      <Composer refresh={refresh} />
      <RunCard />
      {output ? <ResultCard output={output} /> : null}
      {output ? <FeedbackNote /> : null}
      {warning ? (
        <Alert variant="warning">
          <AlertTitle>{warning === 'no-model' ? t('No model yet') : t('No API key yet')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            {found.length > 0 ? (
              <>
                <span>{t('Found on this machine. It uses your subscription: no API key needed.')}</span>
                <span className="flex flex-wrap gap-1.5">
                  {found.map((entry) => (
                    <Button key={entry.preset} size="sm" onClick={() => void addDetected(entry.preset, entry.path)}>
                      {t('Use {name}', { name: entry.label.replace(/ \(.*\)$/, '') })}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => set(tab, 'models')}>
                    {t('Other models')}
                  </Button>
                </span>
              </>
            ) : (
              <span className="flex items-center justify-between gap-2">
                <span>{t('Add one in the Models tab.')}</span>
                <Button size="sm" variant="outline" onClick={() => set(tab, 'models')}>
                  {t('Open Models')}
                </Button>
              </span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
