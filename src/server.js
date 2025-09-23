import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import pkg from 'sqlite3'
const { Database } = pkg
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '../uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

// SQLite setup
const dbFile = path.join(__dirname, '../data.sqlite')
const db = new Database(dbFile)

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, email TEXT, phone TEXT, message TEXT, created_at TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS training_submits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT,
    payload TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS site_content (
    key TEXT PRIMARY KEY,
    value TEXT
  )`)
})

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_')
    cb(null, `${Date.now()}_${base}${ext}`)
  }
})
const upload = multer({ storage })

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }))

// Contact: save
app.post('/api/contact', (req, res) => {
  const { name, email, phone, message } = req.body || {}
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing fields' })
  const created_at = new Date().toISOString()
  db.run(
    'INSERT INTO contact_messages (name,email,phone,message,created_at) VALUES (?,?,?,?,?)',
    [name, email, phone || '', message, created_at],
    function (err) {
      if (err) return res.status(500).json({ error: 'DB error' })
      return res.json({ id: this.lastID, created_at })
    }
  )
})

// Contact: list
app.get('/api/contact', (req, res) => {
  db.all('SELECT * FROM contact_messages ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' })
    res.json(rows)
  })
})

// Trainings: submit (JSON payload from dynamic form)
app.post('/api/trainings/submit', (req, res) => {
  const { values } = req.body || {}
  if (!values || typeof values !== 'object') return res.status(400).json({ error: 'Invalid payload' })
  const created_at = new Date().toISOString()
  db.run('INSERT INTO training_submits (created_at, payload) VALUES (?,?)', [created_at, JSON.stringify(values)], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' })
    res.json({ id: this.lastID, created_at })
  })
})

// Trainings: list
app.get('/api/trainings/submits', (req, res) => {
  db.all('SELECT * FROM training_submits ORDER BY id DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' })
    const out = rows.map(r => ({ id: r.id, createdAt: r.created_at, values: JSON.parse(r.payload || '{}') }))
    res.json(out)
  })
})

// Upload endpoint (for future use)
app.post('/api/upload', upload.single('file'), (req, res) => {
  const fileUrl = `/uploads/${req.file.filename}`
  res.json({ url: fileUrl })
})

// Generic content storage
app.get('/api/content/:key', (req, res) => {
  const { key } = req.params
  db.get('SELECT value FROM site_content WHERE key=?', [key], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' })
    if (!row) return res.status(404).json({ error: 'Not found' })
    try { return res.json(JSON.parse(row.value)) } catch { return res.json(null) }
  })
})

app.put('/api/content/:key', (req, res) => {
  const { key } = req.params
  const value = JSON.stringify(req.body ?? null)
  db.run('INSERT INTO site_content(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value], function (err) {
    if (err) return res.status(500).json({ error: 'DB error' })
    res.json({ ok: true })
  })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))
