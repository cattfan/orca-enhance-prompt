// End-to-end check in the real Orca on this machine: loads this folder as a development plugin
// (local.enhance-prompt, beside the installed cattfan.enhance-prompt, with its own empty storage and
// settings), drives its worker, hook and panel through Orca itself, then unloads it.
//
//   node scripts/e2e.mjs                    # prints the approval fingerprint Orca asks for
//   node scripts/e2e.mjs --approve <fp>     # runs the checks
//
// It only reads: no model is called, nothing is sent to a terminal, nothing is saved.
import { spawnSync } from 'node:child_process'

const approveAt = process.argv.indexOf('--approve')
const fingerprint = approveAt > 0 ? process.argv[approveAt + 1] : null
/** The folder: Orca loads it as its own development plugin (local.enhance-prompt). */
const KEY = '.'

/** Runs `orca plugin …` and parses its --json output. */
function orca(args) {
  // No shell: the --data JSON must reach Orca exactly as written (orca.exe is found on PATH).
  const run = spawnSync('orca', ['plugin', ...args, '--json'], { encoding: 'utf8', timeout: 150_000 })
  const text = (run.stdout ?? '').trim()
  let json = null
  try {
    json = JSON.parse(text.slice(text.indexOf('{')))
  } catch {
    // not JSON (an error line)
  }
  return { code: run.status, json, text: `${text}\n${run.stderr ?? ''}`.trim() }
}

const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
/** What a command answered: { ok, result: … }. */
const call = (run) => run.json?.result ?? null
/** A request's answer: { ok, result: { pluginKey, name, result } }. */
const result = (run) => run.json?.result?.result ?? null

const loaded = orca(['dev', 'load', '.', ...(fingerprint ? ['--approve', fingerprint] : [])])
if (loaded.code === 3) {
  console.log(loaded.text)
  console.log('\nOrca asks for approval (the same access as the installed plugin). Re-run with --approve <fingerprint>.')
  orca(['dev', 'unload', '.'])
  process.exit(3)
}
check('dev load', loaded.code === 0, loaded.code === 0 ? '' : loaded.text.slice(0, 300))

try {
  if (loaded.code === 0) {
    const models = orca(['dev', 'request', KEY, 'models.get'])
    check('models.get answers with the profiles', models.code === 0 && Array.isArray(result(models)?.profiles), models.code === 0 ? `${result(models).profiles.length} profiles` : models.text.slice(0, 200))

    const targets = orca(['dev', 'request', KEY, 'targets.list'])
    check('targets.list answers', targets.code === 0 && Array.isArray(result(targets)?.targets), targets.code === 0 ? `${result(targets).targets.length} terminals` : targets.text.slice(0, 200))

    const summary = orca(['dev', 'request', KEY, 'data.summary'])
    check('data.summary answers', summary.code === 0 && typeof result(summary)?.history === 'number', summary.text.slice(0, 120))

    const preview = orca(['dev', 'request', KEY, 'context.preview', '--data', JSON.stringify({ prompt: 'e2e check', level: 'basic' })])
    const notes = result(preview)?.notes ?? []
    check(
      'context.preview (Basic) answers with coded notes',
      preview.code === 0 && Array.isArray(result(preview)?.context) && notes.every((note) => typeof note === 'object' && typeof note.code === 'string'),
      preview.code === 0 ? `${result(preview).context.length} items` : preview.text.slice(0, 200)
    )

    const empty = orca(['dev', 'request', KEY, 'prompt.enhance', '--data', JSON.stringify({ prompt: '   ' })])
    check('an empty prompt is refused with a coded error', empty.code !== 0 && /Write a prompt first/.test(empty.text), empty.text.slice(0, 160))

    // A prompt shorter than the minimum length passes the hook unchanged, whatever the mode.
    const hook = orca(['dev', 'hook', KEY, 'agent.prompt.before', '--data', JSON.stringify({ agent: 'claude', terminalId: 'e2e', prompt: 'hi', inputKind: 'launch' })])
    check('the auto-enhance hook passes a short prompt unchanged', hook.code === 0 && call(hook)?.decision?.kind === 'continue', hook.text.slice(0, 200))

    // shot takes the plugin key Orca gave the folder (local.enhance-prompt).
    // Right after loading, Orca may not have the panel ready yet: try a few times.
    let shot = null
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000))
      shot = orca(['shot', call(loaded)?.pluginKey ?? 'local.enhance-prompt', '--panel', 'enhance', '--out', '.orca/shots/e2e-enhance.png'])
      if (shot.code === 0) break
    }
    // The first picture after loading can be taken before the worker's first answers have drawn; the
    // panel is open now, so take the one that counts.
    if (shot.code === 0) shot = orca(['shot', call(loaded)?.pluginKey ?? 'local.enhance-prompt', '--panel', 'enhance', '--out', '.orca/shots/e2e-enhance.png'])
    const drawn = call(shot)
    check('the panel draws without errors', shot.code === 0 && drawn?.settled !== false && (drawn?.errors ?? []).length === 0, shot.code === 0 ? `${drawn?.path} ${JSON.stringify(drawn?.errors ?? [])}` : shot.text.slice(0, 200))
  }
} finally {
  const unloaded = orca(['dev', 'unload', '.'])
  check('dev unload', unloaded.code === 0, unloaded.code === 0 ? '' : unloaded.text.slice(0, 200))
}

const failed = results.filter((ok) => !ok).length
console.log(failed ? `\n${failed} check(s) failed` : '\nAll end-to-end checks passed')
process.exit(failed ? 1 : 0)
