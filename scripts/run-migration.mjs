/**
 * One-off migration runner using pg (already installed).
 * Runs the PRD schema v1 migration SQL directly against Supabase.
 * 
 * Usage: node scripts/run-migration.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env manually (no dotenv dependency needed at runtime)
const envPath = resolve(__dirname, '../.env')
const envContent = readFileSync(envPath, 'utf-8')

const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=["']?([^"'\r\n]+)["']?`, 'm'))
  if (!match) throw new Error(`Missing env var: ${key}`)
  return match[1].trim()
}

const getOptionalEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=["']?([^"'\r\n]+)["']?`, 'm'))
  return match?.[1]?.trim() || null
}

const DATABASE_URL = (getOptionalEnv('DIRECT_URL') || getEnv('DATABASE_URL')).replace('?pgbouncer=true', '')

console.log(`Connecting to: ${DATABASE_URL.replace(/:([^:@]+)@/, ':***@')}`)

const client = new Client({ connectionString: DATABASE_URL })

const migrationSQL = readFileSync(
  resolve(__dirname, '../prisma/migrations/20260501064500_prd_schema_v1/migration.sql'),
  'utf-8'
)

async function run() {
  await client.connect()
  console.log('Connected. Running migration...')

  try {
    // Split on semicolons followed by newline, then clean up
    // Don't filter on '--' starts — that drops valid statements preceded by comments
    const rawParts = migrationSQL.split(/;\s*(\r?\n|$)/)
    const statements = rawParts
      .map(s => {
        // Remove full-line comments but keep the actual SQL
        return s
          .split('\n')
          .filter(line => !line.trim().startsWith('--'))
          .join('\n')
          .trim()
      })
      .filter(s => s.length > 0)

    for (const stmt of statements) {
      const preview = stmt.slice(0, 60).replace(/\n/g, ' ')
      process.stdout.write(`  → ${preview}... `)
      try {
        await client.query(stmt)
        console.log('OK')
      } catch (err) {
        if (
          err.message.includes('already exists') ||
          err.message.includes('does not exist')
        ) {
          console.log(`SKIP (${err.message.slice(0, 50)})`)
        } else {
          console.error(`FAIL: ${err.message}`)
          throw err
        }
      }
    }

    console.log('\n✅ Migration completed successfully!')
  } finally {
    await client.end()
  }
}

run().catch(err => {
  console.error('\n❌ Migration failed:', err.message)
  process.exit(1)
})
