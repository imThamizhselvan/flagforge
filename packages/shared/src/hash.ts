// murmurhash3 32-bit — zero deps, deterministic bucketing
function murmurhash3(str: string, seed = 0): number {
  let h = seed
  let i = 0

  while (i < str.length - 3) {
    let k =
      ((str.charCodeAt(i) & 0xff)) |
      ((str.charCodeAt(i + 1) & 0xff) << 8) |
      ((str.charCodeAt(i + 2) & 0xff) << 16) |
      ((str.charCodeAt(i + 3) & 0xff) << 24)

    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
    i += 4
  }

  let tail = 0
  const rem = str.length & 3
  if (rem >= 3) tail ^= (str.charCodeAt(i + 2) & 0xff) << 16
  if (rem >= 2) tail ^= (str.charCodeAt(i + 1) & 0xff) << 8
  if (rem >= 1) {
    tail ^= str.charCodeAt(i) & 0xff
    tail = Math.imul(tail, 0xcc9e2d51)
    tail = (tail << 15) | (tail >>> 17)
    tail = Math.imul(tail, 0x1b873593)
    h ^= tail
  }

  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16

  return h >>> 0
}

// Returns a float in [0, 1) — deterministic for a given flagKey + userKey combo
export function bucket(flagKey: string, userKey: string): number {
  const hash = murmurhash3(`${flagKey}:${userKey}`)
  return (hash % 100) / 100
}
