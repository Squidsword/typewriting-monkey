// src/app.ts
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { Monkey, generatePage } from './monkey'
import { WordHit, WordDetector } from "./word-detector";


const detector = new WordDetector();
const found: WordHit[] = [];

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

const monkey = new Monkey()

app.use(express.static(path.join(__dirname, '../public')))

io.on('connection', socket => {
  socket.emit('cursor', monkey.cursor)
  socket.emit('init-words', found)
})

setInterval(() => {
  const { index, ch } = monkey.next()
  detector.push(ch)
  io.emit("monkey-type", { index, ch })
}, 100)

detector.on("word", hit => {
  found.push(hit);
  io.emit("word", hit);
});

app.get('/page/:id', (req, res) => {
  const idx = parseInt(req.params.id, 10)
  if (Number.isNaN(idx) || idx < 0) {
    res.status(400).end()
  } else {
    res.send(generatePage(idx))
  }
})

const port = process.env.PORT || 5500
httpServer.listen(port, () => console.log(`Server running on port ${port}`))
