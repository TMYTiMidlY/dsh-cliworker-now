import { runNativeSessionHttp } from './native-session-http.mjs'
export const runNativeOpenCode = async (config, io) => {
  if (config.transport === 'opencode-http-v2') return (await import('./native-opencode-v2.mjs')).runNativeOpenCodeV2(config, io)
  return runNativeSessionHttp(config, io, 'opencode')
}

export const forkNativeOpenCode = async (config, io) => {
  const { forkNativeSessionHttp } = await import('./native-session-http.mjs')
  return forkNativeSessionHttp(config, io, 'opencode')
}
