// Pieces every section of the web panel uses: notices as toasts, section headings, help icons, and a
// small Select wrapper over shadcn's.
import { useEffect, type ReactNode } from 'react'
import { read, set } from 'orca'
import { InfoIcon } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { notice } from '../../src/panel/state.ts'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The panel's notices (the shared `notice` atom) as toasts at the bottom: each one is shown once and
 * the atom is emptied. Neutral colours from the theme; errors stay longer.
 */
export function Notices() {
  const current = read(notice)
  useEffect(() => {
    if (!current) return
    const show = { success: toast.success, danger: toast.error, warning: toast.warning, neutral: toast.info }[current.tone]
    show(current.text, { duration: current.tone === 'danger' ? 8000 : 4000 })
    set(notice, null)
  }, [current])
  return (
    <Toaster
      position="bottom-center"
      theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
      closeButton
      toastOptions={{ className: 'text-[13px]' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          '--width': 'min(356px, calc(100vw - 24px))'
        } as React.CSSProperties
      }
    />
  )
}

/** An icon-only button that names itself on hover (and to screen readers). */
export function IconAction({
  label,
  children,
  onClick,
  disabled,
  className,
  variant = 'ghost'
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
  variant?: 'ghost' | 'outline' | 'default' | 'secondary' | 'destructive'
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant={variant} aria-label={label} disabled={disabled} onClick={onClick} className={cn('size-7', className)}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={text} className="text-muted-foreground hover:text-foreground inline-flex">
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

export function Section({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 px-0.5">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
        {hint ? <Hint text={hint} /> : null}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {children}
    </label>
  )
}

/** A settings card: a title over a bordered list of rows (divided). */
export function Group({ title, hint, action, children }: { title?: string; hint?: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title ? (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
            {hint ? <Hint text={hint} /> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="bg-card divide-y overflow-hidden rounded-xl border">{children}</div>
    </section>
  )
}

/** One row of a Group: what it is (and a muted line under it), the control on the right. */
export function Row({ title, description, control, className, children }: { title?: ReactNode; description?: ReactNode; control?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-2 px-3 py-2.5', className)}>
      {title || control ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title ? <div className="text-sm font-medium">{title}</div> : null}
            {description ? <div className="text-muted-foreground text-xs">{description}</div> : null}
          </div>
          {control ? <div className="shrink-0">{control}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

/** A row of mutually exclusive choices (a segmented control). */
export function Segmented({ value, options, onChange, label }: { value: string; options: Option[]; onChange: (value: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-muted grid gap-0.5 rounded-lg p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'truncate rounded-md px-2 py-1 text-xs font-medium transition-colors',
            option.value === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export type Option = { value: string; label: string }

/** shadcn's Select from a list of options. */
export function Pick({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  onOpen
}: {
  label: string
  value: string | undefined
  options: Option[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Called each time the list opens (to reload it). */
  onOpen?: () => void
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled} onOpenChange={(open) => (open ? onOpen?.() : undefined)}>
      <SelectTrigger size="sm" aria-label={label} className={cn('w-full min-w-0', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
