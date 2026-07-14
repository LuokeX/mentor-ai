import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { loadLocalEnv } from './load-env'

loadLocalEnv()
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required; copy .env.example to .env first')
const pool = new Pool({ connectionString: databaseUrl })
await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
await pool.end()
process.stdout.write('Database migrations completed\n')
