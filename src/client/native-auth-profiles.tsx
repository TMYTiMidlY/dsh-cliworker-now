import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, IconRefreshOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { effortLabel, type Effort } from '../shared/types.ts'
import { importAttemptId, confirmImportAttempt, hasUnconfirmedImport } from './native-auth-import-attempts.ts'
import { NativeChoice } from './native-settings-choice.tsx'
import { value, type API } from './workers.ts'
import { authProfileMessage, readAuthTaskApplied, readAuthTaskCatalog, readAuthTaskSettings, readSafeAuthProfile,
  type AuthTaskSettings, type AuthTaskCatalog, type SafeAuthProfile } from './native-auth-profile-data.ts'

/** Registration metadata is not login/entitlement. All writes are explicit,
 * parent-only and source-specific; project native defaults stay separate. */
export function NativeAuthProfiles({ api, sessionId, blocked, onBusyChange }: {
  api: API; sessionId: string; blocked: boolean; onBusyChange?: (busy: boolean) => void
}) {
  const [metadata, setMetadata] = useState<AuthTaskSettings>()
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState('')
  const [importing, setImporting] = useState(false), [sourceRoot, setSourceRoot] = useState(''), [label, setLabel] = useState(''), [region, setRegion] = useState('')
  const [editing, setEditing] = useState<SafeAuthProfile>(), [newLabel, setNewLabel] = useState('')
  const [taskEditor, setTaskEditor] = useState(false), [source, setSource] = useState('native'), [catalog, setCatalog] = useState<AuthTaskCatalog>()
  const [model, setModel] = useState(''), [effort, setEffort] = useState('')
  const request = useRef<AbortController>(), revision = useRef(0), mounted = useRef(true), callbacks = useRef(onBusyChange)
  callbacks.current = onBusyChange
  const previouslyBlocked = useRef(blocked), hint = useId(), formId = useId()
  const service = api.cliworker, writable = !!metadata?.writable && !blocked && !busy
  const sourceName = (id: string) => id === 'native' ? '当前原生账号' : metadata?.profiles.find(p => p.id === id)?.label ?? '当前档案不可用'
  const currentSource = metadata?.current?.authProfile?.id ?? 'native'
  const current = (controller: AbortController, version: number) => mounted.current && request.current === controller && !controller.signal.aborted && revision.current === version
  function begin(write = false) {
    request.current?.abort(); const controller = new AbortController(), version = ++revision.current
    request.current = controller; setError(''); setFeedback(''); setBusy(write); return { controller, version }
  }
  function end(controller: AbortController) { if (mounted.current && request.current === controller) { request.current = undefined; setLoading(false); setBusy(false) } }
  async function refresh() {
    const { controller, version } = begin(); setLoading(true); setCatalog(undefined); setTaskEditor(false)
    try {
      if (!service.authTaskSettings) throw new Error('unsupported')
      const next = readAuthTaskSettings(value(await service.authTaskSettings(sessionId, controller.signal)))
      if (current(controller, version)) { setMetadata(next); setSource(next.current?.authProfile?.id ?? 'native') }
    } catch (caught) { if (current(controller, version)) { setMetadata(undefined); setError(authProfileMessage(caught)) } }
    finally { end(controller) }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; revision.current++; request.current?.abort(); callbacks.current?.(false) } }, [api, sessionId])
  useEffect(() => { callbacks.current?.(busy); return () => callbacks.current?.(false) }, [busy])
  useEffect(() => {
    if (previouslyBlocked.current === blocked) return
    previouslyBlocked.current = blocked; revision.current++; request.current?.abort(); request.current = undefined
    setCatalog(undefined); setModel(''); setEffort(''); setTaskEditor(false); setLoading(false); setBusy(false)
    if (blocked) setMetadata(old => old && ({ ...old, writable: false }))
    else void refresh()
  }, [blocked])
  async function loadCatalog(selected: string) {
    const { controller, version } = begin(); setSource(selected); setCatalog(undefined); setModel(''); setEffort(''); setLoading(true)
    try {
      if (!service.authTaskCatalog) throw new Error('unsupported')
      const next = readAuthTaskCatalog(value(await service.authTaskCatalog(sessionId, selected, controller.signal)), selected)
      if (!current(controller, version)) return
      setCatalog(next)
      if (next.preference) {
        const chosen = next.catalog.models.find(m => m.id === next.preference!.model || Object.values(m.variants ?? {}).includes(next.preference!.model))
        if (chosen && chosen.efforts.includes(next.preference.effort)) { setModel(chosen.id); setEffort(next.preference.effort) }
      }
    } catch (caught) { if (current(controller, version)) setError(authProfileMessage(caught)) }
    finally { end(controller) }
  }
  async function apply() {
    if (!writable || !catalog || !model || !effort || !service.authTaskApply) return
    const chosen = catalog.catalog.models.find(m => m.id === model); if (!chosen?.efforts.includes(effort as Effort)) return
    const submitted = { source, preference: { cli: 'minimax', model, effort, ...(catalog.pin ? { authProfile: catalog.pin } : {}) } }
    const { controller, version } = begin(true)
    try {
      const saved = readAuthTaskApplied(value(await service.authTaskApply(sessionId, JSON.stringify(submitted), controller.signal)), submitted.source, catalog.pin, chosen.variants?.[effort as Effort] ?? chosen.id, effort as Effort)
      if (current(controller, version)) { setMetadata(old => old && ({ ...old, current: saved })); setTaskEditor(false); setCatalog(undefined); setFeedback('已应用到当前主对话之后的新任务；已有会话和项目原生默认未改动') }
    } catch (caught) { if (current(controller, version)) setError(authProfileMessage(caught)) }
    finally { end(controller) }
  }
  async function importProfile() {
    if (!writable || !metadata?.importSupported || !service.authImport || !sourceRoot.startsWith('/') || !label.trim() || !['cn', 'en'].includes(region)) return
    const input = JSON.stringify({ cli: 'minimax', sourceRoot, region, label: label.trim() })
    let requestId: string
    try { requestId = importAttemptId(api, sessionId, input) } catch { setError('存在未确认的导入结果，请先核对列表并重试原请求'); return }
    const submitted = { ...JSON.parse(input), requestId }, { controller, version } = begin(true)
    try {
      const receipt = JSON.parse(value(await service.authImport(sessionId, JSON.stringify(submitted), controller.signal))), profile = readSafeAuthProfile(receipt.profile)
      if (receipt.importScope !== 'account-only') throw new Error('invalid')
      if (current(controller, version)) {
        confirmImportAttempt(api, sessionId, input, requestId)
        setMetadata(old => old && ({ ...old, profiles: [...old.profiles.filter(p => p.id !== profile.id), profile] })); setImporting(false); setSourceRoot(''); setLabel(''); setRegion('')
        setFeedback('账号已独立导入；尚未设置为新任务账号，也未验证模型调用权限')
      }
    } catch (caught) { if (current(controller, version)) setError(authProfileMessage(caught)) }
    finally { end(controller) }
  }
  async function manage(profile: SafeAuthProfile, patch: { enabled?: boolean; label?: string }) {
    if (!writable || !service.authManage) return
    const { controller, version } = begin(true)
    try {
      const receipt = JSON.parse(value(await service.authManage(sessionId, JSON.stringify({ cli: 'minimax', id: profile.id, expectedRecordRevision: profile.recordRevision, requestId: crypto.randomUUID(), ...patch }), controller.signal))), next = readSafeAuthProfile(receipt.profile)
      if (current(controller, version)) { setMetadata(old => old && ({ ...old, profiles: old.profiles.map(p => p.id === next.id ? next : p) })); setEditing(undefined); setTaskEditor(false); setCatalog(undefined); setFeedback('档案已更新；旧会话的固定材料和历史未改动') }
    } catch (caught) { if (current(controller, version)) setError(authProfileMessage(caught)) }
    finally { end(controller) }
  }
  const selectedModel = catalog?.catalog.models.find(m => m.id === model)
  const choices = [{ id: 'native', label: '当前原生账号' }, ...(metadata?.profiles ?? []).map(p => ({ id: p.id, label: `${p.label}${p.enabled ? ' · 独立导入' : ' · 已停用'}`, disabled: !p.enabled }))]
  if (!choices.some(c => c.id === source)) choices.push({ id: source, label: '当前档案不可用', disabled: true } as any)
  return <section className="cwn-settings-section cwn-settings-form" aria-label="独立导入账号">
    <div className="cwn-settings-section-head"><h3>独立导入账号</h3><div className="cwn-settings-section-tools">
      <Button type="button" size="md" variant="ghost" className="cwn-refresh" aria-label="刷新导入账号" disabled={busy || loading} onClick={() => void refresh()}><IconRefreshOutlineRegular size={16} /></Button>
    </div></div>
    <div className="cwn-cli-path-settings">
      <span className="cwn-setting-row-text"><span>仅导入登录及必要保护设置</span><span className="cwn-setting-description" id={hint}>不读取或迁移业务智能体、提示、工作目录及历史，不改原账号。新档案不是原业务环境的克隆；副本续期可能影响同一远端授权，不代表额外额度。</span></span>
      {hasUnconfirmedImport(api, sessionId) && <span className="cwn-setting-description" role="status">有尚未确认的导入请求。请先刷新列表核对；重新打开设置后，原输入重试仍使用同一请求标识。</span>}
      {loading && !metadata && <span className="cwn-setting-description" role="status">正在读取已登记档案…</span>}
      {metadata && <><span className="cwn-setting-description">已保存不等于当前已登录；身份与模型能力在使用前重新核验。{!metadata.writable ? ' 当前主对话不可写，管理操作已禁用。' : ''}{!metadata.importSupported ? ' 此宿主暂不支持安全文件导入。' : ''}</span>
        {!metadata.profiles.length && <span className="cwn-setting-description">尚无独立导入账号</span>}
        {metadata.profiles.map(profile => <div className="cwn-setting-row" key={profile.id}>
          <span className="cwn-setting-row-text"><span>{profile.label}</span><span className="cwn-setting-description">{profile.enabled ? '独立导入 · 已保存，使用前核验' : '已停用 · 不准入新任务'} · 档案 {profile.id.slice(-8)}</span></span>
          <div className="cwn-account-actions"><Button type="button" size="md" variant="ghost" disabled={!writable} onClick={() => { setEditing(profile); setNewLabel(profile.label); setTaskEditor(false) }}>改名</Button><Button type="button" size="md" variant="outline" disabled={!writable} onClick={() => void manage(profile, { enabled: !profile.enabled })}>{profile.enabled ? '停用' : '启用'}</Button></div>
        </div>)}
        {editing && <form className="cwn-cli-path-settings" aria-label="修改档案名称" onSubmit={e => { e.preventDefault(); void manage(editing, { label: newLabel.trim() }) }}><Input aria-label="新的档案名称" value={newLabel} maxLength={100} disabled={!writable} onChange={e => setNewLabel(e.target.value)} /><div className="cwn-cli-path-actions"><Button type="button" size="md" variant="ghost" disabled={busy} onClick={() => setEditing(undefined)}>取消改名</Button><Button type="submit" size="md" variant="outline" disabled={!writable || !newLabel.trim()}>保存名称</Button></div></form>}
        <div className="cwn-cli-path-actions"><Button type="button" size="md" variant="outline" disabled={!writable || !metadata.importSupported} aria-expanded={importing} aria-controls={formId} onClick={() => setImporting(x => !x)}>导入账号<IconChevronDownOutlineRegular size={14} /></Button></div>
        {importing && <form id={formId} className="cwn-cli-path-settings" aria-label="只导入账号" onSubmit={e => { e.preventDefault(); void importProfile() }}>
          <label className="cwn-setting-row-text"><span>宿主原生数据目录</span><span className="cwn-setting-description">填写已授权的绝对目录；不是浏览器上传文件，也不是账号命令别名。</span></label>
          <Input aria-label="宿主原生数据目录" aria-describedby={hint} value={sourceRoot} disabled={!writable} autoComplete="off" spellCheck={false} maxLength={4096} placeholder="填写宿主上的原生数据目录" onChange={e => setSourceRoot(e.target.value)} />
          <Input aria-label="导入档案名称" value={label} disabled={!writable} autoComplete="off" maxLength={100} placeholder="便于区分的账号名称" onChange={e => setLabel(e.target.value)} />
          <label className="cwn-setting-row"><span className="cwn-setting-row-text"><span>原生区域</span></span><NativeChoice label="导入原生区域" selected={region} choices={[{ id: 'cn', label: '国内 cn' }, { id: 'en', label: '国际 en' }]} disabled={!writable} placeholder="选择实际区域" onChange={setRegion} /></label>
          <div className="cwn-cli-path-actions"><Button type="button" size="md" variant="ghost" disabled={busy} onClick={() => setImporting(false)}>取消导入</Button><Button type="submit" size="md" variant="outline" disabled={!writable || !sourceRoot.startsWith('/') || !label.trim() || !region}>验证并独立导入</Button></div>
        </form>}
      </>}
    </div>
    {metadata && <><div className="cwn-setting-row"><span className="cwn-setting-row-text"><span>当前对话的新任务账号</span><span className="cwn-setting-description">{sourceName(currentSource)} · 只影响之后新建的 Worker，已有会话不换号</span></span><Button type="button" size="md" variant="outline" disabled={!writable || loading} onClick={() => { setTaskEditor(true); setEditing(undefined); void loadCatalog(currentSource) }}>设置新任务账号</Button></div>
      {taskEditor && <div className="cwn-cli-path-settings" aria-label="新任务账号完整选型">
        <label className="cwn-setting-row"><span className="cwn-setting-row-text"><span>账号来源</span></span><NativeChoice label="新任务账号来源" selected={source} choices={choices} disabled={!writable} onChange={id => void loadCatalog(id)} /></label>
        {loading && <span className="cwn-setting-description" role="status">正在核验所选来源和读取模型…</span>}
        {catalog && <><label className="cwn-setting-row"><span className="cwn-setting-row-text"><span>模型</span></span><NativeChoice label="新任务模型" selected={model} choices={catalog.catalog.models.map(m => ({ id: m.id, label: m.label }))} disabled={!writable || loading} onChange={id => { setModel(id); const m = catalog.catalog.models.find(x => x.id === id); setEffort(m?.efforts.length === 1 ? m.efforts[0] : '') }} /></label>
          <label className="cwn-setting-row"><span className="cwn-setting-row-text"><span>思考强度</span></span><NativeChoice label="新任务思考强度" selected={effort} choices={(selectedModel?.efforts ?? []).map(e => ({ id: e, label: effortLabel(e) }))} disabled={!writable || loading || !model} onChange={setEffort} placeholder="选择实际支持的强度" /></label>
          {catalog.catalog.notice && <span className="cwn-setting-description">{catalog.catalog.notice}</span>}</>}
        <div className="cwn-cli-path-actions"><Button type="button" size="md" variant="ghost" disabled={busy} onClick={() => { request.current?.abort(); revision.current++; setTaskEditor(false); setCatalog(undefined); setLoading(false) }}>取消选型</Button><Button type="button" size="md" variant="outline" disabled={!writable || loading || !catalog || !model || !effort} onClick={() => void apply()}>应用到新任务</Button></div>
      </div>}
    </>}
    {(error || feedback || busy) && <p className="cwn-cli-path-feedback" role="status">{error || (busy ? '正在验证或保存，请等待原生清理完成…' : feedback)}</p>}
  </section>
}
