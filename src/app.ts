// src/index.ts
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import path from 'path'
import { Monkey, generatePage } from './monkey'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

const monkey = new Monkey()

app.use(express.static(path.join(__dirname, '../public')))

io.on('connection', socket => {
  socket.emit('cursor', monkey.cursor)
})

app.get('/page/:id', (req, res) => {
  const idx = parseInt(req.params.id, 10)
  if (Number.isNaN(idx) || idx < 0) {
    res.status(400).end()
  } else {
    res.send(generatePage(idx))
  }
})

setInterval(() => {
  io.emit('monkey-type', monkey.next())
}, 100)

const port = process.env.PORT || 8080
httpServer.listen(port, () => console.log(`Server running on port ${port}`))
