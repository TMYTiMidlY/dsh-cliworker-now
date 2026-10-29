export const DEFAULT_CONCURRENCY = 8
export const MAX_CONCURRENCY = 12
export type PreparationPhase = 'remote-recovery' | 'admission' | 'authorization' | 'executable' | 'harness-preparation' | 'launch-preparation' | 'running' | 'cleanup'
export type SchedulingReason = PreparationPhase | 'capacity' | 'project-write-conflict' | 'parent-turn' | 'queued' | 'settings-unavailable' | 'host-child-capacity'
export interface ConcurrencySnapshot {
  limit: number | null
  maxLimit: number
  source: 'persisted' | 'initial' | 'unavailable'
  globalActive: number
  globalQueued: number
  parentActive: number
  parentQueued: number
  error?: string
}
export interface WorkerScheduling { reason: SchedulingReason; globalActive: number; limit: number | null }
export const schedulingLabel = (state: WorkerScheduling): string => ({
  capacity: `等待全局运行槽（${state.globalActive}/${state.limit ?? '—'}）`,
  'project-write-conflict': '等待同目录写任务，保持串行',
  'parent-turn': '等待本会话前序任务或公平轮转',
  queued: '已排队，尚未启动 CLI',
  'host-child-capacity': '等待 DSH 宿主子会话容量；原任务保留排队，尚未启动 CLI（非厂商限流）',
  'settings-unavailable': '并发设置无法核验，暂不准入',
  'remote-recovery': '准备中：核验恢复状态', admission: '准备中：核验准入',
  authorization: '准备中：核验当前账号与模型', executable: '准备中：核验原生入口',
  'harness-preparation': '准备中：建立原生子会话', 'launch-preparation': '准备中：准备原生进程',
  running: 'CLI 运行中', cleanup: '正在确认进程清理',
})[state.reason]
