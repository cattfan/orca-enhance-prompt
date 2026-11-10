// testing.ts: the panel for tests. Its state, actions and wiring (state.ts, actions.ts, view.ts,
// setup.ts) run on Orca's panel runtime with nothing drawn: a test calls the actions and reads the
// atoms, which is the code the web panel (web/src) runs under its buttons. Orca never loads this file.
import { mount, type MockHost, type MountOptions, type TestPanel } from 'orca/testing'
import { closePanel, wirePanel } from './setup.ts'

/**
 * Starts the panel on `host` the way the web panel starts, and waits for its first requests
 * (models, terminals, rules, settings). `unmount()` closes it, as closing the panel does.
 */
export async function mountPanel(host: MockHost, options: Omit<MountOptions, 'host'> = {}): Promise<TestPanel> {
  const view = await mount(
    {
      setup: () => {
        const stop = wirePanel()
        return () => {
          closePanel()
          stop()
        }
      },
      default: () => null
    },
    { host, ...options }
  )
  await view.settled()
  return view
}
