import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

if (typeof window !== 'undefined') {
  throw new Error('Prisma config is server-only. Do not import src/config/prisma.js from client components.')
}

const globalForPrisma = globalThis

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('Missing required environment variable: DATABASE_URL')
}

const adapter = new PrismaPg({ connectionString })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
