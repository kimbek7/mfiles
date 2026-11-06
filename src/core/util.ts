import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const index = next++
      await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

export async function hashFile(filePath: string, maxBytes?: number): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath, maxBytes === undefined ? undefined : { end: maxBytes - 1 })
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code
}
