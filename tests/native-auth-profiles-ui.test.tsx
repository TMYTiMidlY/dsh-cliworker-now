import { createElement, forwardRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeAuthProfiles } from '../src/client/native-auth-profiles.tsx'
// Simulated native controls/Gateway only; no browser, source read, Native or HTTP.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, ...props }: any) => createElement('button', props, children),
  Input: forwardRef((props: any, ref: any) => createElement('input', { ...props, ref })),
  IconRefreshOutlineRegular: () => createElement('svg'), IconChevronDownOutlineRegular: () => createElement('svg'),
}))
vi.mock('../src/client/native-settings-choice.tsx', () => ({ NativeChoice: ({ label, selected, choices, disabled, onChange }: any) => createElement('select', { 'aria-label': label, value: selected, disabled, onChange: (event: any) => onChange(event.target.value) }, createElement('option', { value: '' }, '请选择'), choices.map((c: any) => createElement('option', { value: c.id, key: c.id, disabled: c.disabled }, c.label))) }))
const pin = { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' }
const profile = { ...pin, cli: 'minimax', label: 'Synthetic account', recordRevision: 1, enabled: true, state: 'available' }
const ok = (data: any) => ({ ok: true, value: JSON.stringify(data) })
const catalog = (source = pin.id) => ({ controlApiVersion: 1, source, ...(source === 'native' ? {} : { pin }), catalog: { cli: 'minimax', models: [{ id: 'SYNTHETIC_M', label: 'Synthetic model', efforts: ['default', 'high'] }] }, preference: null })
const renderers: ReactTestRenderer[] = []
afterEach(async () => { for (const r of renderers.splice(0)) await act(async () => r.unmount()); vi.restoreAllMocks() })
function fixture(patch: any = {}) {
  const service: any = {
    authTaskSettings: vi.fn(async () => ok({ controlApiVersion: 1, profiles: [profile], current: null, writable: true, importSupported: true, ...patch })),
    authTaskCatalog: vi.fn(async (_p, source) => ok(catalog(source))),
    authTaskApply: vi.fn(async (_p, raw) => { const input = JSON.parse(raw); return ok({ controlApiVersion: 1, ...input, executed: false }) }),
    authImport: vi.fn(async () => ok({ controlApiVersion: 1, profile, importScope: 'account-only' })),
    authManage: vi.fn(async (_p, raw) => { const input = JSON.parse(raw); return ok({ profile: { ...profile, ...('enabled' in input ? { enabled: input.enabled, state: input.enabled ? 'available' : 'disabled' } : {}), ...(input.label ? { label: input.label } : {}), recordRevision: 2 } }) }),
  }
  const api: any = { cliworker: service }, busy = vi.fn(); let renderer!: ReactTestRenderer
  const mount = async () => { await act(async () => { renderer = create(createElement(NativeAuthProfiles, { api, sessionId: 'SYNTHETIC_PARENT', blocked: false, onBusyChange: busy })); renderers.push(renderer) }) }
  const button = (label: string) => renderer.root.findAllByType('button').find(n => n.props['aria-label'] === label || n.children.filter(c => typeof c === 'string').join('').includes(label))!
  const click = async (label: string) => { await act(async () => { const b = button(label); expect(b).toBeTruthy(); expect(b.props.disabled).toBeFalsy(); b.props.onClick() }) }
  const choose = async (label: string, value: string) => { await act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onChange({ target: { value } })) }
  const submit = async (label: string) => { await act(async () => renderer.root.findByProps({ 'aria-label': label }).props.onSubmit({ preventDefault() {} })) }
  return { service, api, busy, mount, button, click, choose, submit, get renderer() { return renderer } }
}
it('reads only safe registration on opening, with no catalog probe, import, apply or quota claim', async () => {
  const f = fixture(); await f.mount()
  expect(f.service.authTaskSettings).toHaveBeenCalledTimes(1); expect(f.service.authTaskCatalog).not.toHaveBeenCalled(); expect(f.service.authImport).not.toHaveBeenCalled(); expect(f.service.authTaskApply).not.toHaveBeenCalled()
  const text = JSON.stringify(f.renderer.toJSON()); expect(text).toContain('不读取或迁移业务'); expect(text).toContain('已保存不等于当前已登录'); expect(text).not.toContain('configDigest'); expect(text).not.toContain('materialRevision')
})
it('keeps management and task writes disabled on a read-only parent', async () => {
  const f = fixture({ writable: false }); await f.mount()
  expect(f.button('导入账号').props.disabled).toBe(true); expect(f.button('设置新任务账号').props.disabled).toBe(true); expect(f.button('停用').props.disabled).toBe(true)
})
it('imports only an explicit host path, region and label without selecting it for tasks', async () => {
  const f = fixture(); await f.mount(); await f.click('导入账号')
  await f.choose('宿主原生数据目录', '/SYNTHETIC_SOURCE'); await f.choose('导入档案名称', 'New synthetic'); await f.choose('导入原生区域', 'cn'); await f.submit('只导入账号')
  const input = JSON.parse(f.service.authImport.mock.calls[0][1]); expect(Object.keys(input).sort()).toEqual(['cli', 'label', 'region', 'requestId', 'sourceRoot']); expect(input.sourceRoot).toBe('/SYNTHETIC_SOURCE')
  expect(f.service.authTaskApply).not.toHaveBeenCalled(); expect(JSON.stringify(f.renderer.toJSON())).toContain('尚未设置为新任务账号')
})
it('does not persist partial model/effort edits or cancellation, and applies only an explicit complete source', async () => {
  const f = fixture(); await f.mount(); await f.click('设置新任务账号'); await f.choose('新任务账号来源', pin.id)
  await f.choose('新任务模型', 'SYNTHETIC_M'); expect(f.button('应用到新任务').props.disabled).toBe(true)
  await f.choose('新任务思考强度', 'high'); expect(f.service.authTaskApply).not.toHaveBeenCalled(); await f.click('取消选型'); expect(f.service.authTaskApply).not.toHaveBeenCalled()
  await f.click('设置新任务账号'); await f.choose('新任务账号来源', pin.id); await f.choose('新任务模型', 'SYNTHETIC_M'); await f.choose('新任务思考强度', 'high'); await f.click('应用到新任务')
  expect(JSON.parse(f.service.authTaskApply.mock.calls[0][1])).toEqual({ source: pin.id, preference: { cli: 'minimax', authProfile: pin, model: 'SYNTHETIC_M', effort: 'high' } })
  expect(JSON.stringify(f.renderer.toJSON())).toContain('已有会话和项目原生默认未改动')
})
it('ignores a late catalog from the previous source and cannot combine its pin with a native model', async () => {
  const f = fixture(); let finish!: (v: any) => void
  f.service.authTaskCatalog.mockImplementation(async (_p: string, source: string) => source === pin.id ? new Promise(ok => { finish = ok }) : ok(catalog(source)))
  await f.mount(); await f.click('设置新任务账号'); await f.choose('新任务账号来源', pin.id)
  await f.choose('新任务账号来源', 'native'); await act(async () => finish(ok(catalog(pin.id))))
  await f.choose('新任务模型', 'SYNTHETIC_M'); await f.choose('新任务思考强度', 'default'); await f.click('应用到新任务')
  expect(JSON.parse(f.service.authTaskApply.mock.calls[0][1]).preference.authProfile).toBeUndefined()
})
it('disabled current profile never silently queries or applies native fallback', async () => {
  const f = fixture({ profiles: [{ ...profile, enabled: false, state: 'disabled' }], current: { cli: 'minimax', authProfile: pin, model: 'SYNTHETIC_M', effort: 'high' } })
  f.service.authTaskCatalog.mockRejectedValue(new Error('AUTH_DISABLED'))
  await f.mount(); await f.click('设置新任务账号')
  expect(f.service.authTaskCatalog.mock.calls.map((x: any) => x[1])).toEqual([pin.id]); expect(f.button('应用到新任务').props.disabled).toBe(true); expect(f.service.authTaskApply).not.toHaveBeenCalled()
})
it('retries an uncertain import with the same request ID, not a fresh duplicate', async () => {
  const f = fixture(); f.service.authImport.mockRejectedValueOnce(new Error('SYNTHETIC_NETWORK_ERROR'))
  await f.mount(); await f.click('导入账号'); await f.choose('宿主原生数据目录', '/SYNTHETIC_SOURCE'); await f.choose('导入档案名称', 'Synthetic retry'); await f.choose('导入原生区域', 'en')
  await f.submit('只导入账号'); await f.submit('只导入账号')
  const inputs = f.service.authImport.mock.calls.map((x: any) => JSON.parse(x[1])); expect(inputs[0].requestId).toBe(inputs[1].requestId)
})
it('keeps an unconfirmed import request ID across dialog close/reopen instead of making a duplicate', async () => {
  const f = fixture(); let finish!: (v: any) => void
  f.service.authImport.mockImplementationOnce(() => new Promise(ok => { finish = ok }))
  const fill = async () => { await f.click('导入账号'); await f.choose('宿主原生数据目录', '/SYNTHETIC_SOURCE'); await f.choose('导入档案名称', 'Synthetic uncertain'); await f.choose('导入原生区域', 'cn'); await f.submit('只导入账号') }
  await f.mount(); await fill(); await act(async () => f.renderer.unmount()); await f.mount(); await fill()
  const requests = f.service.authImport.mock.calls.map((x: any) => JSON.parse(x[1]))
  await act(async () => finish(ok({ controlApiVersion: 1, profile, importScope: 'account-only' })))
  expect(requests[0].requestId).toBe(requests[1].requestId)
})
it('a late old success cannot clear the retry ID of a still-unconfirmed reopened import', async () => {
  const f = fixture(); let oldSuccess!: (v: any) => void, newFailure!: (error: any) => void
  f.service.authImport.mockImplementationOnce(() => new Promise(ok => { oldSuccess = ok })).mockImplementationOnce(() => new Promise((_ok, no) => { newFailure = no }))
  const fill = async () => { await f.click('导入账号'); await f.choose('宿主原生数据目录', '/SYNTHETIC_LATE_SOURCE'); await f.choose('导入档案名称', 'Synthetic late import'); await f.choose('导入原生区域', 'cn'); await f.submit('只导入账号') }
  await f.mount(); await fill(); await act(async () => f.renderer.unmount()); await f.mount(); await fill()
  await act(async () => oldSuccess(ok({ controlApiVersion: 1, profile, importScope: 'account-only' })))
  await act(async () => newFailure(new Error('SYNTHETIC_NEW_REPLY_LOST')))
  await f.submit('只导入账号')
  const ids = f.service.authImport.mock.calls.map((x: any) => JSON.parse(x[1]).requestId)
  expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(1)
})
it('invalidates a pending source catalog when its surrounding connection permission becomes blocked', async () => {
  const f = fixture(); let finish!: (v: any) => void
  f.service.authTaskCatalog.mockImplementation(async (_p: string, source: string) => source === pin.id ? new Promise(ok => { finish = ok }) : ok(catalog(source)))
  await f.mount(); await f.click('设置新任务账号'); await f.choose('新任务账号来源', pin.id)
  await act(async () => f.renderer.update(createElement(NativeAuthProfiles, { api: f.api, sessionId: 'SYNTHETIC_PARENT', blocked: true })))
  await act(async () => finish(ok({ ...catalog(pin.id), preference: { cli: 'minimax', authProfile: pin, model: 'SYNTHETIC_M', effort: 'high' } })))
  await act(async () => f.renderer.update(createElement(NativeAuthProfiles, { api: f.api, sessionId: 'SYNTHETIC_PARENT', blocked: false })))
  const apply = f.button('应用到新任务'); expect(!apply || apply.props.disabled).toBe(true)
  expect(f.service.authTaskApply).not.toHaveBeenCalled()
})
it('does not report a different model/effort receipt as the submitted complete selection', async () => {
  const f = fixture(); f.service.authTaskApply.mockImplementation(async (_p: string, raw: string) => { const input = JSON.parse(raw); return ok({ controlApiVersion: 1, ...input, preference: { ...input.preference, effort: 'high' }, executed: false }) })
  await f.mount(); await f.click('设置新任务账号'); await f.choose('新任务模型', 'SYNTHETIC_M'); await f.choose('新任务思考强度', 'default'); await f.click('应用到新任务')
  expect(JSON.stringify(f.renderer.toJSON())).not.toContain('已应用到当前主对话之后的新任务')
})
it('accepts the exact canonical model variant and default-only native effort contract', async () => {
  const f = fixture()
  f.service.authTaskCatalog.mockResolvedValueOnce(ok({ ...catalog('native'), catalog: { cli: 'minimax', models: [{ id: 'SYNTHETIC_M', label: 'Synthetic model', efforts: ['default', 'high'], variants: { high: 'SYNTHETIC_M-high' } }] } }))
  f.service.authTaskApply.mockImplementation(async (_p: string, raw: string) => { const input = JSON.parse(raw); return ok({ controlApiVersion: 1, ...input, preference: { ...input.preference, model: 'SYNTHETIC_M-high' }, executed: false }) })
  await f.mount(); await f.click('设置新任务账号'); await f.choose('新任务模型', 'SYNTHETIC_M'); await f.choose('新任务思考强度', 'high'); await f.click('应用到新任务')
  expect(JSON.stringify(f.renderer.toJSON())).toContain('已应用到当前主对话之后的新任务')
  f.service.authTaskCatalog.mockResolvedValueOnce(ok({ ...catalog('native'), catalog: { cli: 'minimax', models: [{ id: 'SYNTHETIC_M', label: 'Synthetic default-only model' }] } }))
  await f.click('设置新任务账号'); await f.choose('新任务模型', 'SYNTHETIC_M')
  expect(f.renderer.root.findByProps({ 'aria-label': '新任务思考强度' }).props.value).toBe('default')
})
it('unmount cancels pending metadata and ignores late results without saving', async () => {
  const f = fixture(); let finish!: (v: any) => void
  f.service.authTaskSettings.mockImplementation(() => new Promise(ok => { finish = ok }))
  await f.mount(); const signal = f.service.authTaskSettings.mock.calls[0][1]
  await act(async () => f.renderer.unmount()); expect(signal.aborted).toBe(true)
  await act(async () => finish(ok({ controlApiVersion: 1, profiles: [profile], current: null, writable: true, importSupported: true })))
  expect(f.service.authTaskApply).not.toHaveBeenCalled(); expect(f.service.authImport).not.toHaveBeenCalled()
})
