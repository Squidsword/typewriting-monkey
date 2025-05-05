// src/monkey.ts
import seedrandom from 'seedrandom'

export const PAGE_SIZE = 512
const SECRET_SEED = 'rest in peace my precious hunter'

const charFromRng = (rng: () => number) =>
  String.fromCharCode(Math.floor(rng() * 26) + 97)

/** Deterministically regenerates a full page */
export const generatePage = (pageIdx: number): string => {
  const rng = seedrandom(SECRET_SEED)
  for (let i = 0; i < pageIdx * PAGE_SIZE; i++) rng()
  let out = ''
  for (let i = 0; i < PAGE_SIZE; i++) out += charFromRng(rng)
  return out
}

export class Monkey {
  private rng = seedrandom(SECRET_SEED)
  private _cursor = 0

  get cursor() {
    return this._cursor
  }

  next() {
    const ch = charFromRng(this.rng)
    return { index: this._cursor++, ch }
  }
}
