import { useEffect, useId, useRef, useState } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConcurrencySnapshot } from '../shared/scheduling.ts'
import { MAX_CONCURRENCY } from '../shared/scheduling.ts'
import { NativeChoice } from './native-settings-choice.tsx'
import { operationMessage } from './operation-error.ts'
import { value, type API } from './workers.ts'
interface State extends ConcurrencySnapshot { writable: boolean; reason?: string }
function decode(raw: string): State {
  const data = JSON.parse(raw)
  if (!data || typeof data.writable !== 'boolean' || !(data.limit === null || Number.isInteger(data.limit) && data.limit >= 1 && data.limit <= MAX_CONCURRENCY) ||
    ['globalActive', 'globalQueued', 'parentActive', 'parentQueued'].some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)) throw new Error('并发状态无法核验，请刷新')
  return data
}
/** Global budget has an explicit shared scope; never a CLI/account default. */
export function ConcurrencySettingsPane({ api, sessionId }: { api: API; sessionId: string }) {
  const [data, setData] = useState<State>(), [draft, setDraft] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0), [feedback, setFeedback] = useState('')
  const description = useId(), generation = useRef(0)
  useEffect(() => {
    generation.current++
    const controller = new AbortController()
    setData(undefined); setSaving(false); setError(''); setFeedback('')
    void (async () => {
      try {
        if (!api.cliworker.readConcurrency) throw new Error('当前 Host 尚未提供在线并发设置，请先更新插件')
        const next = decode(value(await api.cliworker.readConcurrency(sessionId, controller.signal)))
        if (!controller.signal.aborted) { setData(next); setDraft(next.limit === null ? '' : String(next.limit)) }
      } catch (issue) { if (!controller.signal.aborted) setError(operationMessage(issue)) }
    })()
    return () => { generation.current++; controller.abort() }
  }, [api, sessionId, attempt])
  const save = async (selected: string) => {
    const epoch = generation.current
    setDraft(selected); setSaving(true); setError(''); setFeedback('正在保存')
    try {
      if (!api.cliworker.configureConcurrency) throw new Error('当前 Host 尚未提供在线并发设置')
      const next = decode(value(await api.cliworker.configureConcurrency(sessionId, Number(selected), new AbortController().signal)))
      if (generation.current === epoch) { setData(next); setFeedback('已保存并立即应用；在途任务保持运行') }
    } catch (issue) { if (generation.current === epoch) { setError(`未保存；当前已生效限制仍为 ${data?.limit ?? '未知'}。${operationMessage(issue)}`); setFeedback('') } }
    finally { if (generation.current === epoch) setSaving(false) }
  }
  return <section className="cwn-settings-pane" aria-label="并发与排队设置">
    <div className="cwn-cli-identity"><div className="cwn-settings-cli-name"><h2>并发与排队</h2></div></div>
    <section className="cwn-settings-section">
      <div className="cwn-settings-section-head"><h3>全局运行预算</h3>
        <Button variant="ghost" size="md" className="cwn-refresh" aria-label="刷新并发状态" disabled={saving} onClick={() => setAttempt(value => value + 1)}><IconRefreshOutlineRegular size={18} /></Button>
      </div>
      <div className="cwn-settings-form"><div className="cwn-setting-row">
        <div className="cwn-setting-row-text"><span>最大并发</span><span id={description} className="cwn-setting-description">影响所有 CLI 和父会话，不是厂商配额。默认8，可选1–12。提高立即释放可运行队列；降低不停止在途任务，同会话和同目录写任务仍串行。</span></div>
        <NativeChoice label="全局最大并发" selected={draft} choices={Array.from({ length: MAX_CONCURRENCY }, (_, index) => ({ id: String(index + 1), label: String(index + 1) }))}
          disabled={!data?.writable || saving} placeholder="尚未读取" describedBy={description} onChange={selected => void save(selected)} />
      </div><div className="cwn-setting-row"><div className="cwn-setting-row-text"><span>运行占位快照（可刷新）</span>
        <span className="cwn-setting-description">{data ? `全局 ${data.globalActive}/${data.limit ?? '—'}，排队 ${data.globalQueued}；本会话占位 ${data.parentActive}，排队 ${data.parentQueued}。占位包含授权、子会话准备和清理，不等于已经请求模型。` : '正在读取真实状态；不猜测进度或其他会话任务。'}</span>
      </div></div></div>
      {(error || data?.reason || feedback) && <p className="cwn-settings-notice" role="status">{error || data?.reason || feedback}</p>}
    </section>
  </section>
}
