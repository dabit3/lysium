/**
 * Local dev API server — mirrors the Vercel serverless functions in api/
 * Handles: /api/devin/session, /api/devin/proxy/*, /api/github/oauth/*
 *
 * Run alongside Vite: npm run dev:all
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'

// Load .env.local / .env
;['.env.local', '.env'].forEach((file) => {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) return
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      line = line.trim()
      if (!line || line.startsWith('#')) return
      if (line.startsWith('export ')) line = line.slice(7).trim()
      const idx = line.indexOf('=')
      if (idx <= 0) return
      const key = line.slice(0, idx).trim()
      const val = line.slice(idx + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
      if (key && process.env[key] === undefined) process.env[key] = val
    })
})

const PORT = parseInt(process.env.DEV_API_SERVER_PORT ?? '8787', 10)

// Dynamically import handlers (they use ESM)
const { default: sessionHandler } = await import('../api/devin/session.mjs')
const { default: proxyHandler } = await import('../api/devin/proxy.mjs')
const { default: oauthHandler } = await import('../api/github/oauth/[route].mjs')

// Minimal req/res adapter to match Vercel's handler signature
const adapt = (req, res) => {
  // Add Vercel-style helpers
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  }
  res.send = (data) => res.end(data)
  res.redirect = (code, location) => {
    if (typeof code === 'string') { location = code; code = 302 }
    res.statusCode = code
    res.setHeader('Location', location)
    res.end()
  }
  return { req, res }
}

const server = createServer(async (req, res) => {
  const { req: r, res: w } = adapt(req, res)
  const path = req.url?.split('?')[0] ?? '/'

  try {
    if (path === '/api/devin/session') {
      await sessionHandler(r, w)
    } else if (path.startsWith('/api/devin/proxy')) {
      await proxyHandler(r, w)
    } else if (path.startsWith('/api/github/oauth')) {
      await oauthHandler(r, w)
    } else {
      w.status(404).json({ error: 'Not found' })
    }
  } catch (err) {
    console.error('[dev-api]', err)
    if (!res.headersSent) w.status(500).json({ error: 'Internal server error' })
  }
})

server.listen(PORT, () => {
  process.stdout.write(`Dev API server listening on http://localhost:${PORT}\n`)
})
