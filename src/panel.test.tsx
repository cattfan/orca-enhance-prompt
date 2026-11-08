// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const status = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  keySource: 'secret' as const,
  envName: 'OPENAI_API_KEY',
  autoEnhanceMode: 'off'
}

test('enhances, then sends to the chosen agent', async () => {
  const sent: { terminalId: string; text: string }[] = []
  const host = mockHost({
    requests: {
      'config.status': status,
      'targets.list': { targets: [{ terminalId: 't1', label: 'Claude · waiting', agent: 'claude' }] },
      'prompt.enhance': ({ prompt }) => ({ enhanced: `Better: ${prompt}`, model: 'gpt-4.1-mini', provider: 'openai', ms: 1200 }),
      'prompt.send': (input) => {
        sent.push(input)
        return { accepted: true }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.type({ label: 'Your prompt' }, 'add tests')
  await view.press({ role: 'button', text: 'Enhance' })
  assert.equal(view.valueOf(view.find({ label: 'Enhanced prompt' })!), 'Better: add tests')

  await view.press({ role: 'button', text: 'Send to agent' })
  assert.deepEqual(sent, [{ terminalId: 't1', text: 'Better: add tests', enter: false }])
  assert.ok(view.find({ text: /Sent to Claude/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('warns when no API key is configured', async () => {
  const host = mockHost({
    requests: {
      'config.status': { ...status, keySource: 'none' },
      'targets.list': { targets: [] }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'No API key yet' }) ?? view.find({ text: /No API key yet/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
