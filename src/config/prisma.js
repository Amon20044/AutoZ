import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

if (typeof window !== 'undefined') {
  throw new Error('Prisma config is server-only. Do not import src/config/prisma.js from client components.')
}

const globalForPrisma = globalThis

const connectionString = process.env.DATABASE_URL

function createPrismaClient() {
  if (!connectionString) return null
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma
}

export default prisma
