import io from "socket.io-client"

interface MonkeyEvt { index:number; ch:string }
interface WordHit   { start:number; len:number }

const PAGE_SIZE = 512
const pages:Record<number,string> = {}
const hits:WordHit[] = []

let cursor = 0
const output = document.getElementById("output") as HTMLPreElement

/* ---------- helpers ---------- */

const fetchPage = async (idx:number) => {
  if (pages[idx] !== undefined) return
  const r = await fetch(`/page/${idx}`)
  if (r.ok) pages[idx] = await r.text()
}

const visibleText = ():string => {
  const last = Math.floor(cursor / PAGE_SIZE)
  const limit = cursor % PAGE_SIZE

  return Array.from({length:last+1}, (_,i)=>i)
    .map(i=>{
      const pg = pages[i] ?? ""
      return i===last ? pg.slice(0,limit) : pg
    })
    .join("")
}

/* remove overlaps, longest word wins */
const pruneHits = (xs:WordHit[]):WordHit[] => {
  const sorted = [...xs].sort((a,b)=>a.start-b.start || b.len-a.len*-1)
  const out:WordHit[] = []
  for (const h of sorted){
    const prev = out[out.length-1]
    if (!prev || h.start >= prev.start+prev.len){
      out.push(h)
    } else if (h.len > prev.len){
      out[out.length-1] = h            // replace shorter overlapping word
    }
  }
  return out
}

/* build HTML with <span class="word">…</span> around hits */
const render = () => {
  const txt  = visibleText()
  const nonOverlap = pruneHits(hits.filter(h=>h.start < txt.length))

  let html = ""
  let pos  = 0
  for (const h of nonOverlap){
    html += txt.slice(pos, h.start)
    html += `<span class="word len${h.len}">${txt.slice(h.start, h.start+h.len)}</span>`
    pos    = h.start + h.len
  }
  html += txt.slice(pos)
  output.innerHTML = html
}

/* ---------- socket wiring ---------- */

;(async () => {
  const socket = io()

  socket.on("cursor", async (cur:number)=>{
    cursor = cur
    const max = Math.floor(cursor / PAGE_SIZE)
    for (let i=0;i<=max;i++) await fetchPage(i)
    render()
  })

  socket.on("init-words",(arr:WordHit[])=>{
    hits.push(...arr)
    render()
  })

  socket.on("word",(hit:WordHit)=>{
    hits.push(hit)
    render()
  })

  socket.on("monkey-type", async ({index,ch}:MonkeyEvt)=>{
    const page = Math.floor(index / PAGE_SIZE)
    if (pages[page] === undefined) await fetchPage(page)

    const off = index % PAGE_SIZE
    pages[page] = pages[page].slice(0,off) + ch + pages[page].slice(off+1)

    cursor = index + 1
    render()
  })
})()