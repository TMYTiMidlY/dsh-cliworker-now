import { expect, it } from 'vitest'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { HostChildCapacityDeferred, isHostChildCapacityError, hostAdmissionBackoff } from '../src/host/host-child-admission.ts'
import { schedulingLabel } from '../src/shared/scheduling.ts'
it('accepts exact local SDK capacity and cold Remote preserved cause, never the message alone', () => {
  const capacity = new SubagentError('synthetic', 'ACTIVATION_LIMIT_REACHED')
  expect(isHostChildCapacityError(capacity)).toBe(true)
  expect(isHostChildCapacityError(new RemoteError('subagent/delivery-unavailable', 'synthetic', {}, { cause: capacity }))).toBe(true)
  for (const error of [new Error('active child limit: 8'), { code: 'ACTIVATION_LIMIT_REACHED' },
    new RemoteError('subagent/delivery-unavailable', 'synthetic', {}),
    new RemoteError('gateway/internal', 'synthetic', {}, { cause: capacity }),
    new AggregateError([capacity], 'cleanup unconfirmed')]) expect(isHostChildCapacityError(error)).toBe(false)
})
it.each(['DRAINING', 'ACTIVATION_CLOSING', 'UNAUTHORIZED', 'CONTINUATION_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE'])('does not retry SDK %s even inside delivery-unavailable', code => {
  const error = new SubagentError('synthetic', code)
  expect(isHostChildCapacityError(error)).toBe(false)
  expect(isHostChildCapacityError(new RemoteError('subagent/delivery-unavailable', 'synthetic', {}, { cause: error }))).toBe(false)
})
it('uses finite low-frequency delays and safe diagnostics without pretending to know Host active counts', () => {
  expect([1, 2, 3, 4, 5, 1000].map(hostAdmissionBackoff)).toEqual([2000, 4000, 8000, 16000, 30000, 30000])
  const authority = {}, error = new HostChildCapacityDeferred(authority, 'synthetic-private-candidate')
  expect(error.authority).toBe(authority); expect(error.message).not.toContain('synthetic-private')
  const label = schedulingLabel({ reason: 'host-child-capacity', globalActive: 12, limit: 12 })
  expect(label).toContain('DSH'); expect(label).toContain('尚未启动 CLI'); expect(label).not.toMatch(/12|8\/|已审/)
})
