/**
 * Prisma Client Singleton
 *
 * This module provides a singleton instance of Prisma Client that handles
 * proper lifecycle management in both development and production environments.
 *
 * In development, we reuse the same instance to avoid hot-reload issues.
 * In production, we ensure a single client is created and reused.
 *
 * Environment: Automatically loads .env for development and .env.test for tests.
 * Test isolation: npm test uses dotenv -e .env.test to load test database config.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Fail fast if DATABASE_URL is not set to avoid silent fallbacks
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. " +
    "Set it in .env (development) or .env.test (tests), " +
    "or use 'dotenv -e .env.test -- <command>' to run with a specific env file."
  );
}

export const prisma =
  globalForPrisma.prisma ||
  (() => {
    // Pool and adapter construction moved inside singleton guard to prevent
    // re-allocation on hot-reload. Each construction is expensive and should
    // only happen once per process.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    const adapter = new PrismaPg(pool);

    return new PrismaClient({
      adapter,
      log:
        process.env.NODE_ENV === "development"
          ? ["query", "error", "warn"]
          : ["error"],
    });
  })();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
