/**
 * Mark a migration as applied in _prisma_migrations directly via pg.
 * Used when Prisma's advisory lock mechanism fails (Supabase pgBouncer issue).
 * 
 * Usage: node scripts/mark-migration-applied.mjs <migration_name>
 * Example: node scripts/mark-migration-applied.mjs 20260501064500_prd_schema_v1
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

const migrationName = process.argv[2]
if (!migrationName) {
  console.error('Usage: node scripts/mark-migration-applied.mjs <migration_name>')
  process.exit(1)
}

const envPath = resolve(__dirname, '../.env')
const envContent = readFileSync(envPath, 'utf-8')

const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=["']?([^"'\r\n]+)["']?`, 'm'))
  if (!match) throw new Error(`Missing env var: ${key}`)
  return match[1].trim()
}

const DATABASE_URL = getEnv('DATABASE_URL').replace('?pgbouncer=true', '')

const migrationSQLPath = resolve(
  __dirname,
  `../prisma/migrations/${migrationName}/migration.sql`
)

const migrationSQL = readFileSync(migrationSQLPath, 'utf-8')
const checksum = createHash('sha256').update(migrationSQL).digest('hex')

console.log(`Migration: ${migrationName}`)
console.log(`Checksum:  ${checksum}`)
console.log(`Connecting to: ${DATABASE_URL.replace(/:([^:@]+)@/, ':***@')}`)

const client = new Client({ connectionString: DATABASE_URL })

async function run() {
  await client.connect()

  // Check if _prisma_migrations table exists
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = '_prisma_migrations'
    )
  `)

  if (!tableCheck.rows[0].exists) {
    console.log('Creating _prisma_migrations table...')
    await client.query(`
      CREATE TABLE "_prisma_migrations" (
        id                      VARCHAR(36) NOT NULL PRIMARY KEY,
        checksum                VARCHAR(64) NOT NULL,
        finished_at             TIMESTAMPTZ,
        migration_name          VARCHAR(255) NOT NULL,
        logs                    TEXT,
        rolled_back_at          TIMESTAMPTZ,
        started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_steps_count     INTEGER NOT NULL DEFAULT 0
      )
    `)
  }

  // Check if migration already exists
  const existing = await client.query(
    'SELECT id, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1',
    [migrationName]
  )

  if (existing.rows.length > 0) {
    const row = existing.rows[0]
    if (row.finished_at && !row.rolled_back_at) {
      console.log(`\n✅ Migration already marked as applied (finished_at: ${row.finished_at})`)
      return
    }

    // Update the existing failed/rolled-back row
    await client.query(
      `UPDATE "_prisma_migrations"
       SET finished_at = now(), rolled_back_at = NULL, logs = NULL,
           applied_steps_count = 1, checksum = $1
       WHERE migration_name = $2`,
      [checksum, migrationName]
    )
    console.log('\n✅ Updated existing migration row → marked as applied!')
  } else {
    // Insert new applied row
    const id = crypto.randomUUID()
    await client.query(
      `INSERT INTO "_prisma_migrations"
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      [id, checksum, migrationName]
    )
    console.log('\n✅ Inserted migration row → marked as applied!')
  }
}

run()
  .catch(err => {
    console.error('\n❌ Failed:', err.message)
    process.exit(1)
  })
  .finally(() => client.end())
