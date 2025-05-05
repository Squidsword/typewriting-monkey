import io from "socket.io-client"

interface MonkeyEvt { index: number; ch: string }

const PAGE_SIZE = 512
const pages: Record<number, string> = {}

let cursor = 0                         // <— current server cursor
const output = document.getElementById("output") as HTMLPreElement

const render = () => {
  const lastPage = Math.floor(cursor / PAGE_SIZE)
  const limit    = cursor % PAGE_SIZE

  const txt = [...Array(lastPage + 1).keys()]            // 0 … lastPage
    .map(i => {
      const pg = pages[i] ?? ""                           // blank until fetched
      return i === lastPage ? pg.slice(0, limit) : pg     // hide future chars
    })
    .join("")

  output.textContent = txt
}

const getPage = async (idx: number) => {
  if (pages[idx] !== undefined) return
  const r = await fetch(`/page/${idx}`)
  if (r.ok) pages[idx] = await r.text()
}

;(async () => {
  const socket = io()

  socket.on("cursor", async (cur: number) => {
    cursor = cur
    const maxPage = Math.floor(cursor / PAGE_SIZE)
    for (let i = 0; i <= maxPage; i++) await getPage(i)
    render()
  })

  socket.on("monkey-type", async ({ index, ch }: MonkeyEvt) => {
    const pageIdx = Math.floor(index / PAGE_SIZE)
    if (pages[pageIdx] === undefined) await getPage(pageIdx)

    const off = index % PAGE_SIZE
    pages[pageIdx] =
      pages[pageIdx].slice(0, off) + ch + pages[pageIdx].slice(off + 1)

    cursor = index + 1                // advance visible frontier
    render()
  })
})()
