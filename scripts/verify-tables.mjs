import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
const getEnv = (k) => envContent.match(new RegExp(`^${k}=["']?([^"'\r\n]+)["']?`, 'm'))?.[1]?.trim()

const client = new Client({ connectionString: getEnv('DATABASE_URL').replace('?pgbouncer=true', '') })
await client.connect()

const { rows } = await client.query(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
)

console.log('\nTables in Supabase DB:')
rows.forEach(r => console.log(' ✓', r.table_name))

await client.end()
