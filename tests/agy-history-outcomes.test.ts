import { describe, expect, it } from 'vitest'
import { runNativeAgy } from '../src/host/native-agy.mjs'

type NativeRecord = Record<string, any>
const id = 'synthetic-history-conversation'
const streamError = 'The stream was interrupted. Please continue the task you were working on.'
const quota = 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 18h6m38s.'
const step = (index: number, type: string, state: unknown = 'DONE', extra: NativeRecord = {}): NativeRecord => ({
  event: 'step_update', step_update: { conversation_id: id, step_index: index, step_type: type, state, ...extra },
})
const init = (model = 'SYNTHETIC_FLASH'): NativeRecord => ({ event: 'init', conversation_id: id, init: { model } })
const end = (error = streamError, patch: NativeRecord = {}): NativeRecord => ({ event: 'result', result: {
  conversation_id: id, status: 'ERROR', response: 'SYNTHETIC_CURRENT_RESULT', error, ...patch,
} })
const completed = (start = 10, text = 'SYNTHETIC_CURRENT_RESULT'): NativeRecord[] => [
  step(start, 'user_input'), step(start + 1, 'system_message'),
  step(start + 2, 'tool', 'DONE', { tool_name: 'read_file', tool_info: { name: 'read_file', parameters: {} } }),
  step(start + 3, 'agent_response', 'DONE', { text_delta: text }),
]

// All transcripts, model names and exit conditions are synthetic. The current
// production runner is used, but no process, CLI, model, account or filesystem
// tool is executed. Historical native exit codes were not retained: tests must
// never be described as proving those old runs exited zero.
async function replay(records: NativeRecord[], options: {
  exitCode?: number; resume?: boolean; model?: string; cleanupFails?: boolean; aborted?: boolean
} = {}) {
  if (process.env.CLIWORKER_AGY_HARNESS_SESSION_FILE) throw new Error('Synthetic replay refuses a live harness carrier')
  const events: NativeRecord[] = [], results: NativeRecord[] = []
  let listener!: (record: NativeRecord) => void, predicate!: (record: NativeRecord) => boolean
  let resolve!: (record: NativeRecord) => void, reject!: (error: Error) => void, closed = false
  const completion = new Promise<NativeRecord>((a, b) => { resolve = a; reject = b })
  const peer = {
    onMessage: (callback: typeof listener) => { listener = callback; return () => {} },
    waitFor: (test: typeof predicate) => { predicate = test; return completion },
    send: async () => {
      let terminal = false
      for (const record of records) { listener(record); if (predicate(record)) { terminal = true; resolve(record) } }
      if (!terminal) reject(new Error('SYNTHETIC_MISSING_TERMINAL'))
    },
    end: () => {}, kill: () => {}, done: Promise.resolve({ exitCode: options.exitCode ?? 0 }),
    close: async () => { closed = true; if (options.cleanupFails) throw new Error('SYNTHETIC_CLEANUP_FAILED') },
  }
  const model = options.model ?? 'SYNTHETIC_FLASH', prompt = 'SYNTHETIC_HISTORY_REPLAY_ONLY'
  const control = new AbortController()
  if (options.aborted) control.abort(new Error('SYNTHETIC_CANCELLED'))
  const config = { preference: { cli: 'antigravity', model, effort: 'high' }, mode: 'accept-edits',
    prompt, project: '/synthetic-no-filesystem-access', timeoutMs: 1000,
    ...(options.resume === false ? {} : { conversationId: id }),
    argv: ['--output-format', 'stream-json', '--model', model, '--effort', 'high', '--mode', 'accept-edits',
      ...(options.resume === false ? [] : ['--conversation', id]), '--print', `任务：\n${prompt}`],
  }
  await runNativeAgy(config, { signal: control.signal, openStdio: async () => peer,
    session: () => {}, native: () => {}, event: (event: NativeRecord) => events.push(event),
    result: (status: string, response: string, error: string | undefined, scope: string) => results.push({ status, response, error, scope }),
  })
  return { events, result: results.at(-1)!, results, closed }
}

describe('synthetic AGY historical completion conflicts', () => {
  it('recognizes completed native system metadata without asserting native ERROR was success', async () => {
    const value = await replay([init(), ...completed(), end()])
    expect(value.result).toMatchObject({ status: 'UNCERTAIN', response: 'SYNTHETIC_CURRENT_RESULT', scope: 'run' })
    expect(value.result.error).toContain(streamError)
    expect(value.events.some(event => event.kind === 'diagnostic' && event.text.includes('未识别步骤类型'))).toBe(false)
    expect(value.closed).toBe(true)
    const exit = value.events.find(event => event.kind === 'diagnostic' && event.text === 'Antigravity 原生进程退出证据')
    expect(exit).toBeDefined()
    expect(JSON.parse(exit!.detail)).toMatchObject({ exitCode: 0, source: 'process-supervisor' })
  })
  it('does not treat an error_message record as harmless metadata even if its state and summary are DONE/SUCCESS', async () => {
    const value = await replay([init(), ...completed(), step(30, 'error_message'), end('', { status: 'SUCCESS' })])
    expect(value.result.status).toBe('ERROR')
    expect(value.result.response).toBe('SYNTHETIC_CURRENT_RESULT')
  })
  it('keeps an ordinary SUCCESS with known system metadata successful and diagnostic-free', async () => {
    const value = await replay([init(), ...completed(), end('', { status: 'SUCCESS' })])
    expect(value.result.status).toBe('SUCCESS')
    expect(value.events.filter(event => event.kind === 'diagnostic')).toHaveLength(0)
  })
  it.each([
    ['active system', step(11, 'system_message', 'ACTIVE')],
    ['failed system', step(11, 'system_message', 'ERROR')],
    ['missing state', step(11, 'system_message', 'DONE', { state: undefined })],
    ['invalid state', step(11, 'system_message', 123)],
    ['explicit error', step(11, 'system_message', 'DONE', { error: 'SYNTHETIC_CURRENT_ERROR' })],
    ['error flag', step(11, 'system_message', 'DONE', { is_error: true })],
    ['invalid index', step(-1, 'system_message')],
    ['wrong delta type', step(11, 'system_message', 'DONE', { text_delta: 123 })],
    ['error message DONE', step(11, 'error_message')],
    ['unknown type DONE', step(11, 'SYNTHETIC_FUTURE_STEP')],
  ] as const)('does not waive %s to manufacture an all-DONE conflict', async (_name, system) => {
    const items = completed(); items[1] = system
    expect((await replay([init(), ...items, end()])).result.status).toBe('ERROR')
  })
  it('preserves an observed error even after that system step later reports DONE', async () => {
    expect((await replay([init(), step(11, 'system_message', 'ERROR'), ...completed(), end()])).result.status).toBe('ERROR')
  })
  it('does not reuse an index with a different known type', async () => {
    expect((await replay([init(), step(11, 'tool'), ...completed(), end()])).result.status).toBe('ERROR')
  })
  it('keeps a current explicit top-level error despite system DONE', async () => {
    const items = completed(); items[1] = { ...items[1], error: 'SYNTHETIC_CURRENT_ERROR' }
    expect((await replay([init(), ...items, end()])).result.status).toBe('ERROR')
  })
  it('does not infer a clean native exit or a resumed identity', async () => {
    const records = [init(), ...completed(), end()]
    expect((await replay(records, { exitCode: 3 })).result.status).toBe('ERROR')
    expect((await replay(records, { resume: false })).result.status).toBe('ERROR')
  })
  it('rejects missing native terminal, changed identity, cancellation and failed cleanup', async () => {
    await expect(replay([init(), ...completed()])).rejects.toThrow('SYNTHETIC_MISSING_TERMINAL')
    await expect(replay([init(), step(11, 'system_message', 'DONE', { conversation_id: 'synthetic-other' }), end()])).rejects.toThrow('会话身份')
    await expect(replay([init(), ...completed(), end()], { aborted: true })).rejects.toThrow('SYNTHETIC_CANCELLED')
    await expect(replay([init(), ...completed(), end()], { cleanupFails: true })).rejects.toThrow('SYNTHETIC_CLEANUP_FAILED')
  })
})

describe('synthetic same-conversation model switch with repeated quota summary', () => {
  it('separates an original Argon quota error, a real current tool error, and later completed Flash output', async () => {
    const original = await replay([init('SYNTHETIC_ARGON'), step(0, 'user_input'), step(1, 'error_message'),
      end(quota, { response: '', num_turns: 1 })], { model: 'SYNTHETIC_ARGON', resume: false })
    expect(original.result).toMatchObject({ status: 'ERROR', response: '' })
    expect(original.result.error).toContain(quota)
    const withToolError = await replay([init(), step(2, 'user_input'), step(3, 'system_message'),
      step(7, 'tool', 'ERROR', { tool_name: 'read_file', tool_info: { error: 'SYNTHETIC_OFFSET_OUT_OF_RANGE' } }),
      step(9, 'tool'), step(10, 'agent_response', 'DONE', { text_delta: 'SYNTHETIC_FLASH_FIRST' }),
      end(quota, { response: 'SYNTHETIC_FLASH_FIRST', num_turns: 2 })])
    expect(withToolError.result).toMatchObject({ status: 'ERROR', response: 'SYNTHETIC_FLASH_FIRST' })
    expect(withToolError.result.error).toContain(quota)
    expect(withToolError.result.error).toContain('并非当前模型余额查询')
    expect(withToolError.events.some(event => event.kind === 'tool' && event.state === 'FAILED')).toBe(true)
    const current = await replay([init(), ...completed(11, 'SYNTHETIC_FLASH_SECOND'),
      end(quota, { response: 'SYNTHETIC_FLASH_SECOND', num_turns: 3 })])
    expect(current.result).toMatchObject({ status: 'UNCERTAIN', response: 'SYNTHETIC_FLASH_SECOND' })
    expect(current.result.error).toContain(quota)
    expect(current.result.error).toContain('不要自动重试')
    expect(current.results).toHaveLength(1)
  })
  it('keeps real current quota evidence failed even after earlier text was produced', async () => {
    const value = await replay([init(), ...completed(), step(20, 'error_message', 'DONE', { error: quota }), end(quota)])
    expect(value.result.status).toBe('ERROR')
    expect(value.result.error).toContain(quota)
    expect(value.result.response).toBe('SYNTHETIC_CURRENT_RESULT')
  })
  it('does not erase the native quota declaration behind a generic nonzero exit, and does not claim a queried balance', async () => {
    const value = await replay([init(), step(0, 'user_input'), step(1, 'error_message'),
      end(quota, { response: '' })], { exitCode: 3, resume: false })
    expect(value.result.status).toBe('ERROR')
    expect(value.result.error).toContain('exitCode=3')
    expect(value.result.error).toContain(quota)
    expect(value.result.error).toContain('并非当前模型余额查询')
    const exit = value.events.find(event => event.kind === 'diagnostic' && event.text === 'Antigravity 原生进程退出证据')
    expect(exit).toBeDefined()
    expect(JSON.parse(exit!.detail)).toMatchObject({ exitCode: 3, source: 'process-supervisor' })
  })
})
