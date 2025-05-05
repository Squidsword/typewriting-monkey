import io from "socket.io-client"


interface MonkeyEvt { index: number; ch: string }

const PAGE_SIZE = 512
const pages: Record<number, string> = {}
const output = document.getElementById("output") as HTMLPreElement

const render = () => {
  const sorted = Object.keys(pages).map(Number).sort((a, b) => a - b)
  output.textContent = sorted.map(i => pages[i]).join("")
}

const getPage = async (idx: number) => {
  if (pages[idx] !== undefined) return
  const r = await fetch(`/page/${idx}`)
  if (r.ok) pages[idx] = await r.text()
}

const mergeChar = (idx: number, ch: string) => {
  const pageIdx = Math.floor(idx / PAGE_SIZE)
  const off = idx % PAGE_SIZE
  if (pages[pageIdx] === undefined) return
  pages[pageIdx] =
    pages[pageIdx].slice(0, off) + ch + pages[pageIdx].slice(off + 1)
}

;(async () => {
  for (let i = 0; i < 4; i++) await getPage(i)
  render()

  const socket = io()
  socket.on("monkey-type", async ({ index, ch }: MonkeyEvt) => {
    const p = Math.floor(index / PAGE_SIZE)
    if (pages[p] === undefined) await getPage(p)
    mergeChar(index, ch)
    render()
  })

  socket.on("cursor", async (cur: number) => {
    const p = Math.floor(cur / PAGE_SIZE)
    await getPage(p)
    render()
  })
})()
