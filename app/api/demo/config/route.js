/**
 * GET  /api/demo/config — returns the current landing demo snapshot (public).
 * POST /api/demo/config — overwrites public/demo/demo-config.json.
 *
 * Writes are LOCALHOST-only. The landing demo is a static asset committed to
 * the repo: developer edits locally → saves → git commits → push to Vercel.
 * Vercel serves the static JSON; /frame/demo fetches it client-side. Zero DB
 * involvement on either side.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { isLocalhostRequest } from '@/lib/demo-auth'

const CONFIG_FILE = path.join(process.cwd(), 'public', 'demo', 'demo-config.json')

async function readConfig() {
  const raw = await fs.readFile(CONFIG_FILE, 'utf8')
  return JSON.parse(raw)
}

export async function GET() {
  try {
    const config = await readConfig()
    return NextResponse.json(
      { success: true, config },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' } },
    )
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
  if (!isLocalhostRequest(request)) {
    return NextResponse.json({
      error: 'Demo config writes are localhost-only. Run the editor locally, commit public/demo/demo-config.json, and push to deploy.',
      code: 'LOCAL_ONLY',
    }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const next = body?.config
  if (!next || typeof next !== 'object') {
    return NextResponse.json({ error: 'Missing config object.' }, { status: 400 })
  }
  if (!next.model?.url || typeof next.model.url !== 'string') {
    return NextResponse.json({ error: 'config.model.url is required.' }, { status: 400 })
  }

  const merged = {
    ...next,
    publishedAt: new Date().toISOString(),
  }

  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    return NextResponse.json({
      success: true,
      config: merged,
      file: 'public/demo/demo-config.json',
      hint: 'git add public/demo/demo-config.json && git commit -m "demo: update landing config" && git push',
    })
  } catch (err) {
    return NextResponse.json({
      error: `Could not persist demo config (${err.code || 'unknown'}). Check that public/demo/ is writable.`,
    }, { status: 500 })
  }
}
