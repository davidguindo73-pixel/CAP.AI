import pg from "pg";

const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;

let schemaReady;

export async function ensureAdsSchema() {
  if (!pool) return false;
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS cap_ad_campaigns (
        id UUID PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'approved', 'archived')),
        notes TEXT NOT NULL DEFAULT '',
        brief JSONB NOT NULL,
        deliverables JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS cap_ad_campaigns_owner_created_idx
        ON cap_ad_campaigns (owner_hash, created_at DESC);
    `).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
  return true;
}
