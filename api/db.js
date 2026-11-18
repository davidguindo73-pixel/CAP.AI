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

let saasSchemaReady;

export async function ensureSaasSchema() {
  if (!pool) {
    const error = new Error("CAP.AI customer features require PostgreSQL. Configure DATABASE_URL.");
    error.status = 503;
    throw error;
  }
  await ensureAdsSchema();
  if (!saasSchemaReady) {
    saasSchemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS cap_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cap_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES cap_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS cap_sessions_user_idx ON cap_sessions(user_id);
      CREATE INDEX IF NOT EXISTS cap_sessions_expiry_idx ON cap_sessions(expires_at);
      CREATE TABLE IF NOT EXISTS cap_business_profiles (
        user_id UUID PRIMARY KEY REFERENCES cap_users(id) ON DELETE CASCADE,
        profile JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cap_oauth_states (
        state_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES cap_users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
        redirect_uri TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cap_oauth_states_expiry_idx ON cap_oauth_states(expires_at);
      CREATE TABLE IF NOT EXISTS cap_connected_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES cap_users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('meta','google','tiktok')),
        remote_user_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT,
        access_token_expires_at TIMESTAMPTZ,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, platform, remote_user_id)
      );
      CREATE INDEX IF NOT EXISTS cap_connections_user_platform_idx
        ON cap_connected_accounts(user_id, platform);
      CREATE TABLE IF NOT EXISTS cap_billing_accounts (
        user_id UUID PRIMARY KEY REFERENCES cap_users(id) ON DELETE CASCADE,
        stripe_customer_id TEXT UNIQUE,
        stripe_subscription_id TEXT,
        subscription_status TEXT NOT NULL DEFAULT 'inactive',
        plan TEXT NOT NULL DEFAULT 'free',
        current_period_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS cap_platform_publications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES cap_users(id) ON DELETE CASCADE,
        campaign_id UUID NOT NULL,
        platform TEXT NOT NULL,
        external_campaign_id TEXT,
        external_adset_id TEXT,
        external_ad_id TEXT,
        status TEXT NOT NULL DEFAULT 'paused',
        budget_amount NUMERIC(12,2),
        currency TEXT NOT NULL DEFAULT 'USD',
        destination_url TEXT,
        provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS cap_publications_user_created_idx
        ON cap_platform_publications(user_id, created_at DESC);
    `).catch((error) => {
      saasSchemaReady = undefined;
      throw error;
    });
  }
  await saasSchemaReady;
  return true;
}
