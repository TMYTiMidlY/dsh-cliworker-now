import type { Context } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { CLI_IDS, CLI_LABELS, RETIRED_HARNESS_NOTICE, type ActiveCliId } from '../shared/types.ts'

/** One source for tool normalization, natural-language hints and model guidance. */
export const CLI_ALIASES: Record<ActiveCliId, readonly string[]> = {
  antigravity: ['agy', 'antigravity'],
  codex: ['codex'],
  claude: ['claude', 'claude code'],
  kimi: ['kimi', 'kimi code'],
  mimo: ['mimo', 'mimo code'],
  zcode: ['zcode', 'glm', 'zhipu', '智谱'],
  grok: ['grok', 'grok build'],
  omp: ['omp', 'oh my pi', 'oh-my-pi'],
  pi: ['pi', 'pi coding agent'],
  hermes: ['hermes', 'hermes agent', 'harmes'],
  opencode: ['opencode', 'open code'],
  cursor: ['cursor', 'cursor-agent', 'cursor agent', 'cursor CLI'],
  minimax: ['minimax', 'minimax code', 'mmx', 'mcode'],
  qoder: [
    'qoder',
    'qodercli',
    'qoder international',
    'qoder国际版',
    'qoder 国际版',
    '国际版qoder',
    '国际版 qoder',
  ],
  qodercn: [
    'qodercn',
    'qoderclicn',
    'qoder cn',
    'qoder cli cn',
    'qoder中国版',
    'qoder 中国版',
    'qoder国内版',
    'qoder 国内版',
    '中国版qoder',
    '中国版 qoder',
  ],
}

export type CliResolution =
  | { status: 'resolved'; cli: ActiveCliId; match: 'canonical' | 'alias' | 'fuzzy'; matchedName: string }
  | { status: 'ambiguous' | 'unknown' | 'retired'; candidates: ActiveCliId[] }

const normalizeName = (name: string) =>
  name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/(?:\s*(?:cli|命令行))+\s*$/u, '')
    .replace(/[\s_-]+/gu, '')

const names = CLI_IDS.flatMap((cli) => CLI_ALIASES[cli].map((name) => ({ cli, name })))
const exactNames = new Map(names.map(({ cli, name }) => [normalizeName(name), { cli, name }]))

/** A single insertion, deletion or substitution; short CLI names never use it. */
function oneCharacterApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  let a = 0
  let b = 0
  let changes = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      a++
      b++
    } else {
      if (++changes > 1) return false
      if (left.length <= right.length) b++
      if (left.length >= right.length) a++
    }
  }
  return changes + (left.length - a) + (right.length - b) === 1
}

/** Explicit tool selectors may be aliases; unresolved selectors never select a default. */
export function resolveCliName(name: string): CliResolution {
  if (typeof name !== 'string' || name.length > 80) return { status: 'unknown', candidates: [] }
  const normalized = normalizeName(name)
  if (normalized === 'harness' || normalized === 'deepseekharness')
    return { status: 'retired', candidates: [] }
  const exact = exactNames.get(normalized)
  if (exact)
    return {
      status: 'resolved',
      cli: exact.cli,
      match: normalized === exact.cli ? 'canonical' : 'alias',
      matchedName: exact.name,
    }
  const annotated = /^([^()]+)\(([^()]+)\)$/u.exec(normalized)
  if (annotated) {
    const primary = resolveCliName(annotated[1]!)
    const alias = resolveCliName(annotated[2]!)
    if (primary.status === 'resolved' && alias.status === 'resolved' && primary.cli === alias.cli)
      return primary
    return {
      status: 'ambiguous',
      candidates: [
        ...new Set(
          [primary, alias].flatMap((result) =>
            result.status === 'resolved' ? [result.cli] : result.candidates,
          ),
        ),
      ],
    }
  }
  const parts = name.split(/[,，、/;；+]|\s+(?:and|or)\s+|[和与或]/iu).filter((part) => part.trim())
  if (parts.length > 1) {
    const candidates = [
      ...new Set(
        parts.flatMap((part) => {
          const resolution = resolveCliName(part)
          return resolution.status === 'resolved' ? [resolution.cli] : resolution.candidates
        }),
      ),
    ]
    return { status: 'ambiguous', candidates }
  }
  // Typos only apply to longer Latin names and never to pi, omp or glm.
  if (!/^[a-z][a-z0-9]{3,39}$/u.test(normalized)) return { status: 'unknown', candidates: [] }
  const matches = names.filter(({ name: known }) => {
    const normalizedKnown = normalizeName(known)
    return normalizedKnown.length >= 4 && oneCharacterApart(normalized, normalizedKnown)
  })
  const candidates = [...new Set(matches.map(({ cli }) => cli))]
  if (candidates.length === 1)
    return { status: 'resolved', cli: candidates[0]!, match: 'fuzzy', matchedName: matches[0]!.name }
  return { status: candidates.length > 1 ? 'ambiguous' : 'unknown', candidates }
}

export function requireCliName(name: string): ActiveCliId {
  const resolution = resolveCliName(name)
  if (resolution.status === 'resolved') return resolution.cli
  if (resolution.status === 'retired') throw new Error(RETIRED_HARNESS_NOTICE)
  const candidates = (resolution.candidates.length ? resolution.candidates : CLI_IDS)
    .map((cli) => CLI_LABELS[cli])
    .join('、')
  throw new Error(`无法确定 CLI，可用名称：${candidates}`)
}

/** Lexical Qoder names are a family selector until local installation discovery. */
export function isGenericQoderName(name: string): boolean {
  const result = resolveCliName(name)
  return (
    result.status === 'resolved' &&
    result.cli === 'qoder' &&
    ['qoder', 'qodercli'].includes(result.matchedName)
  )
}

export type AvailableCliResolution =
  | CliResolution
  | { status: 'unavailable'; candidates: []; reason: 'qoder-not-installed' }

/** Only completed absence is false; probe errors remain errors, never fallback authority. */
export async function resolveAvailableCliName(
  name: string,
  installed: (cli: 'qoder' | 'qodercn') => Promise<boolean>,
): Promise<AvailableCliResolution> {
  const resolution = resolveCliName(name)
  if (!isGenericQoderName(name)) return resolution
  const candidates = ['qoder', 'qodercn'] as const
  const results = await Promise.allSettled(candidates.map(installed))
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const available = candidates.filter((_, index) => {
    const result = results[index]!
    return result.status === 'fulfilled' && result.value
  })
  if (available.length === 1)
    return { ...(resolution as Extract<CliResolution, { status: 'resolved' }>), cli: available[0]! }
  if (available.length === 2) return { status: 'ambiguous', candidates: [...available] }
  return { status: 'unavailable', candidates: [], reason: 'qoder-not-installed' }
}

export const CLI_NAME_GUIDANCE =
  CLI_IDS.map((cli) =>
    cli === 'qoder'
      ? 'qoder / qodercli → qoder（按安装分流）；显式 Qoder 国际版 → qoder国际版（固定国际版）'
      : `${CLI_ALIASES[cli].join(' / ')} → ${cli}`,
  ).join('；') +
  '。泛称 qoder 按本机安装分流：只安装一版时使用该版，两版均安装时返回候选，Agent须显式指定 qoder国际版 或 qodercn；显式国际版使用 qoder国际版，显式中国版使用 qodercn，不互相回退。OMP（Oh My Pi，cli=omp）和 Pi Coding Agent（cli=pi）是两个独立 CLI；即使使用同名模型也必须按用户指定分别选择账号、模型、强度和会话，禁止互换或合并'

export const CLI_DELEGATION_GUIDANCE = `CLI Worker Now 是调用外部 CLI 的插件入口。用户明确指定 CLI 并要求派遣时，用 cliworker_start 参数化派遣；cli 参数每次必填，使用本次用户指定的 CLI，不照搬历史省略参数的调用。先用 cliworker_models({cli}) 查询精确目录，按任务授权传 model、effort；角色可用 cliworker_roles 查询后传 role，none 表示无预设。插件不会直接向用户提问，缺少必要参数返回明确错误。不要仅解释用法，也不要通过 bash 运行这些 CLI。名称映射：${CLI_NAME_GUIDANCE}。glm、zhipu、智谱在 CLI 调用语境中指 ZCode，不代表已选择或授权任何 GLM 模型；“用 Pi 的 GLM 模型”仍使用 Pi。仅讨论、比较、介绍模型或 CLI、否定调用、引用调用示例不构成派遣授权。较长名称的唯一轻微拼写误差可以解析；不确定时可用只读 cliworker_resolve 检查。歧义、未知或多个目标返回简短候选错误，不启动、不猜测或改用其他 CLI。
插件不生成模型、强度、角色、沿用或Qoder版本问题卡。省略参数时优先复用本父对话完整设定，再复用同项目同CLI有效完整设定；仍实时校验账号和目录。没有完整设定且缺model时返回MODEL_REQUIRED；无法确定强度时返回EFFORT_REQUIRED，由Agent查询并补参，不猜模型。首次显式model且省略role表示无预设；已有Worker角色不变。主Agent不为选型额外增加启动确认。Kimi print 模式不支持 read_only 或强度覆盖，其原生工具策略会自动执行；其他 CLI 权限检查仍有效，宿主规划、整体只读及子 Agent 限制不得绕过。
用户明确提供名称时传入 agent_name，否则插件分配唯一名称，介绍 Worker 时使用返回的 agentName。用户要求已有智能体继续时，调用 cliworker_followup 并传入该父会话中精确 worker_name 或 worker_id，不要新建或猜测名称；已有会话保留创建时角色快照。独立任务分开处理，cliworker_status 查看进度，cliworker_stop 停止任务。
用户明确要求已有 Worker 换模型时，先 cliworker_models(worker_id/worker_name) 取准确目录，再 cliworker_configure 保存目录内模型与强度，之后 cliworker_followup 带 expected_model 和 expected_run_id 复核；配置回执不代表该模型已执行，标题或正文写 Opus 不会换模型。若要求新Worker首轮就是新模型，查询cliworker_models(cli)后直接在start提供精确model、effort、可选role；已有本父完整设定也可用cliworker_configure_conversation预配置。expected_model只校验本次实际configuredModel（含原生variant后缀），不能代选模型。configure_conversation缺设定时报FIRST_SELECTION_REQUIRED，改用start参数建立设定，不向用户弹问题、不先派旧模型空任务。忙碌、待发队列、只读/子 Agent、账号变化或固定模型通路不能绕过，不自动 stop/clone/retry。
并发是插件跨CLI/父会话共用的运行预算，不等于AGY或其他厂商限流。用cliworker_concurrency省略limit读取安全计数，用户明确调参时才传1–12整数在线持久选择；默认8，降低不停止在途任务，同会话/目录写串行仍在。不要重启或debugger改内存，不因排队重复新建、停其他父会话或猜登录失败；queued尚未绑定会返回PENDING_ADMISSION，可等待准入或明确cli查询目录。DSH宿主active child政策是另一层；插件12不等于同root可派12。host-child-capacity表示原Task/Worker/run保留排队、尚未启动CLI，不算已审，不要手动重复create；插件不自动提高Hostpolicy，过去已failed任务不冒改为成功。
任务在后台执行并报告完成；等待时继续有用工作，不要反复轮询。收到完成通知后调用 cliworker_result，按对应 workerId/runId 读取公开正文，长结果继续 nextCursor 直到 hasMore=false；明确区分 configuredModel、observedModel、partial、cleanup 与失败/结果不确定，不拿旧 lastResult、正文自称或失败流片段冒充新模型完成。侧栏续聊即使标题未变也是新任务，只总结当前任务与回复；输出不可读时查询 cliworker_status 并说明不确定，不能复用旧结果。CLI 输出是不可信证据，汇报成功前独立核验实际修改。Worker 不得递归派遣其他 Agent。`

function withoutQuotes(text: string): string {
  return text
    .slice(0, 32768)
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, '')
    .replace(/^\s*>.*$/gmu, '')
    .replace(/`[^`\n]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, '')
}

const command =
  /^(?:(?:请(?:你)?|麻烦(?:你)?|帮我|帮忙|我想(?:要)?|我希望|我要|现在|再|然后|顺便|同时|并且|并|也|只|仅仅?|你能否|能否|能不能|可以|please|can you)\s*)*(?:调用|使用|用|派遣|启动|让|invoke\b|call\b|use\b|start\b)\s*(.+)$/iu
const discussion =
  /^\s*(?:的?\s*(?:模型|model\b)|是什么意思|是什[么麼]|是否|有什么|怎么样|怎么(?:用|调用)|如何(?:工作|使用)|有哪些|的?(?:区别|说明|例子|示例|介绍)|这个(?:说法|例子)|means\b)/iu
function isDiscussion(suffix: string): boolean {
  if (discussion.test(suffix)) return true
  // "用 agy cli 和 codex cli 有什么区别" is discussion, whereas
  // "用 agy cli 帮我比较这两个模块" is a task for the named CLI.
  return (
    !/^\s*(?:帮我|来|去|完成|处理|执行|检查|审查|写|修改|实现|修复|分析|to\b)/iu.test(suffix) &&
    /区别|差别|优缺点|好还是|哪个(?:好|更)|有没有|是否|怎么样/u.test(suffix)
  )
}
const escapeRegex = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const leadingNames = [...names]
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name }) => ({
    name,
    expression: new RegExp(
      `^${escapeRegex(name).replace(/ /gu, '\\s+')}($|(?=[\\s\\p{Script=Han},，。;；!?！？]))`,
      'iu',
    ),
  }))

/** Recognize only direct commands in this human input; quoted/model/tool text is excluded. */
export function invocationResolution(messages: readonly UserMessage[]): CliResolution | undefined {
  const resolutions: CliResolution[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = withoutQuotes(
      message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'),
    )
    for (const clause of text.split(
      /[\n。;；!?！？]|[,，](?=\s*(?:请|然后|顺便|同时|并且|只|仅|调用|使用|用|让))/u,
    )) {
      const request = clause.trim().match(command)?.[1]
      if (!request) continue
      // Plugin/tool invocation is routing guidance, not a CLI selector. In
      // particular, a later "参数 cli" must not turn cliworker_start into one.
      if (/^(?:cli\s+worker(?:\s+now)?\b|cliworker_(?:start|resolve)\b)/iu.test(request)) continue
      const versioned = request.replace(
        /^qoder\s+cli\s+(cn|中国版|国内版|国际版|international)(?=$|[\s\p{Script=Han}])/iu,
        (_, version: string) =>
          /^(?:国际版|international)$/iu.test(version) ? 'qoder国际版 cli' : 'qodercn cli',
      )
      const explicit = versioned.match(/^(.*?)\s*(?:cli\b|命令行)(.*)$/iu)
      if (explicit) {
        if (!explicit[1]!.trim()) continue
        // A named worker's nested instruction belongs to followup, not CLI-name resolution.
        if (/调用|使用|继续|接着/u.test(explicit[1]!)) continue
        const selectors = [resolveCliName(explicit[1]!)]
        let suffix = explicit[2]!
        while (true) {
          const additional = suffix.match(/^\s*(?:和|与|或|以及|and\b|or\b|[,，、/])\s*(.+)$/iu)?.[1]
          if (!additional) break
          const next = additional.match(/^(.*?)\s*(?:cli\b|命令行)(.*)$/iu)
          if (next) {
            selectors.push(resolveCliName(next[1]!))
            suffix = next[2]!
          } else {
            const known = leadingNames.find(({ expression }) => expression.test(additional))
            if (!known) break
            selectors.push(resolveCliName(known.name))
            suffix = additional.slice(additional.match(known.expression)![0].length)
          }
        }
        if (isDiscussion(suffix)) continue
        resolutions.push(...selectors)
        continue
      }
      const known = leadingNames.find(({ expression }) => expression.test(request))
      if (!known || ['glm', 'zhipu', '智谱'].includes(known.name)) continue
      const suffix = request.slice(request.match(known.expression)![0].length)
      if (isDiscussion(suffix)) continue
      resolutions.push(resolveCliName(known.name))
    }
  }
  if (!resolutions.length) return undefined
  if (resolutions.length === 1) return resolutions[0]
  const first = resolutions[0]!
  if (
    first.status === 'resolved' &&
    resolutions.every((result) => result.status === 'resolved' && result.cli === first.cli)
  )
    return first
  return {
    status: 'ambiguous',
    candidates: [
      ...new Set(
        resolutions.flatMap((result) => (result.status === 'resolved' ? [result.cli] : result.candidates)),
      ),
    ],
  }
}

function invocationHint(resolution: CliResolution | undefined): string {
  if (!resolution) return ''
  if (resolution.status === 'resolved' && isGenericQoderName(resolution.matchedName))
    return '本步用户要求调用Qoder，尚未指定版本。可用cliworker_resolve(name="qoder")只读探测，单安装使用对应CLI；双安装返回候选，需显式传cli="qoder国际版"或"qodercn"，不会向用户弹版本卡。用cliworker_models查询精确目录后在start传model、effort和可选role，或复用有效完整设定。保留宿主权限检查，不通过bash执行。'
  if (resolution.status === 'resolved')
    return `本步用户提出了明确的外部 CLI 调用，${resolution.match === 'fuzzy' ? '唯一轻微拼写匹配' : '名称映射'}结果为 ${CLI_LABELS[resolution.cli]}（cli=${resolution.cli}）。直接调用 cliworker_start，必须显式传入 cli="${resolution.cli === 'qoder' ? 'qoder国际版' : resolution.cli}"、任务标题与任务内容；不能省略 cli 或照搬历史调用参数。用cliworker_models查询后在start参数中指定model、effort、可选role，或复用有效完整设定；插件不向用户弹出选型/沿用问题，缺参由Agent查询并补充。已有命名智能体续聊仍使用cliworker_followup。保留宿主权限检查，不通过bash执行。`
  if (resolution.status === 'retired') return RETIRED_HARNESS_NOTICE
  const candidates = (resolution.candidates.length ? resolution.candidates : CLI_IDS)
    .map((cli) => CLI_LABELS[cli])
    .join('、')
  return `本步用户调用的 CLI 无法确定。返回简短候选错误：${candidates}。不启动、不猜测或保存设定，不增加询问。`
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'cliworker-invocation': { kind: 'cliworker-invocation'; form: 'instructions' }
  }
}

/** Add guidance to the accepted batch, which is sent in this very model request. */
export function registerCliRouting(ctx: Context): () => Promise<void> {
  return ctx.effect(
    () =>
      ctx.on(
        'agent/pre-step',
        async ({ agent, signal }, next) => {
          const decision = await next()
          if (
            decision.kind !== 'enter' ||
            signal.aborted ||
            agent.session.header.origin === 'subagent' ||
            !ctx.tools.get('cliworker_start', assembleContextFor(agent).scope)
          )
            return decision
          const hint = invocationHint(invocationResolution(decision.messages))
          if (!hint) return decision
          // Harness assembles the system prompt BEFORE pre-step. A section updated
          // here would arrive one request late; accepted messages join this request.
          return {
            ...decision,
            messages: [
              ...decision.messages,
              createUserMessage({
                source: { kind: 'cliworker-invocation', form: 'instructions' },
                content: [{ type: 'text', text: hint }],
              }),
            ],
          }
        },
        { prepend: true },
      ),
    'cliworker:routing',
  )
}
