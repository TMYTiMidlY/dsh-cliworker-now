export interface NativeAuthGuardBuild {
  schema: number
  protocol: number
  platform: string
  arch: string
  sourceSha256: string
  supported: boolean
  libc?: string
  buildGlibc?: string
  binarySha256?: string
}
export function buildNativeAuthGuard(options: { root: string; outDir: string; platform?: string; arch?: string }): NativeAuthGuardBuild
