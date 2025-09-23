import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import pkgPg from 'pg'
const { Pool } = pkgPg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '../uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

// Postgres setup (Neon or any Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL_DISABLED ? false : { rejectUnauthorized: false },
})

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS contact_messages (
    id SERIAL PRIMARY KEY,
    name TEXT, email TEXT, phone TEXT, message TEXT, created_at TEXT
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS training_submits (
    id SERIAL PRIMARY KEY,
    created_at TEXT,
    payload TEXT
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS site_content (
    key TEXT PRIMARY KEY,
    value TEXT
  )`)
}
ensureSchema().catch((e)=>{
  console.error('Failed to initialize database schema', e)
  process.exit(1)
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
  pool.query(
    'INSERT INTO contact_messages (name,email,phone,message,created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [name, email, phone || '', message, created_at]
  ).then(({ rows }) => res.json({ id: rows[0].id, created_at }))
   .catch(() => res.status(500).json({ error: 'DB error' }))
})

// Contact: list
app.get('/api/contact', (req, res) => {
  pool.query('SELECT * FROM contact_messages ORDER BY id DESC')
    .then(({ rows }) => res.json(rows))
    .catch(() => res.status(500).json({ error: 'DB error' }))
})

// Trainings: submit (JSON payload from dynamic form)
app.post('/api/trainings/submit', (req, res) => {
  const { values } = req.body || {}
  if (!values || typeof values !== 'object') return res.status(400).json({ error: 'Invalid payload' })
  const created_at = new Date().toISOString()
  pool.query('INSERT INTO training_submits (created_at, payload) VALUES ($1,$2) RETURNING id', [created_at, JSON.stringify(values)])
    .then(({ rows }) => res.json({ id: rows[0].id, created_at }))
    .catch(() => res.status(500).json({ error: 'DB error' }))
})

// Trainings: list
app.get('/api/trainings/submits', (req, res) => {
  pool.query('SELECT id, created_at, payload FROM training_submits ORDER BY id DESC')
    .then(({ rows }) => {
      const out = rows.map(r => ({ id: r.id, createdAt: r.created_at, values: JSON.parse(r.payload || '{}') }))
      res.json(out)
    })
    .catch(() => res.status(500).json({ error: 'DB error' }))
})

// Upload endpoint (for future use)
app.post('/api/upload', upload.single('file'), (req, res) => {
  const fileUrl = `/uploads/${req.file.filename}`
  res.json({ url: fileUrl })
})

// Generic content storage
app.get('/api/content/:key', (req, res) => {
  const { key } = req.params
  pool.query('SELECT value FROM site_content WHERE key=$1', [key])
    .then(({ rows }) => {
      const row = rows[0]
      if (!row) return res.status(404).json({ error: 'Not found' })
      try { return res.json(JSON.parse(row.value)) } catch { return res.json(null) }
    })
    .catch(() => res.status(500).json({ error: 'DB error' }))
})

app.put('/api/content/:key', (req, res) => {
  const { key } = req.params
  const value = JSON.stringify(req.body ?? null)
  pool.query('INSERT INTO site_content(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, value])
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ error: 'DB error' }))
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`))
