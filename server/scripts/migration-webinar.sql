-- ============================================================
-- Migration: Webinar feature
-- 3 tabelas: webinar_configs, webinar_sessions, webinar_registrations
-- ============================================================

-- ── 1. webinar_configs ──────────────────────────────────────
-- 1 config por time. Define slug público + logo + textos.
CREATE TABLE IF NOT EXISTS webinar_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL DEFAULT 'Webinar',
  description text,
  logo_url    text,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinar_configs_team_id_unique UNIQUE (team_id),
  CONSTRAINT webinar_configs_slug_format CHECK (slug ~ '^[a-z0-9-]+$' AND length(slug) BETWEEN 3 AND 50)
);

CREATE INDEX IF NOT EXISTS idx_webinar_configs_slug ON webinar_configs(slug);
CREATE INDEX IF NOT EXISTS idx_webinar_configs_team ON webinar_configs(team_id);

-- ── 2. webinar_sessions ─────────────────────────────────────
-- Cada config tem N sessões (datas/horários + link do webinar).
CREATE TABLE IF NOT EXISTS webinar_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id     uuid NOT NULL REFERENCES webinar_configs(id) ON DELETE CASCADE,
  scheduled_at  timestamptz NOT NULL,
  webinar_link  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webinar_sessions_config ON webinar_sessions(config_id);
CREATE INDEX IF NOT EXISTS idx_webinar_sessions_scheduled ON webinar_sessions(scheduled_at);

-- ── 3. webinar_registrations ────────────────────────────────
-- Inscrições dos visitantes via página pública. Duplicatas permitidas.
CREATE TABLE IF NOT EXISTS webinar_registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  config_id     uuid NOT NULL REFERENCES webinar_configs(id) ON DELETE CASCADE,
  guest_name    text NOT NULL,
  guest_email   text NOT NULL,
  guest_phone   text,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webinar_registrations_session ON webinar_registrations(session_id);
CREATE INDEX IF NOT EXISTS idx_webinar_registrations_config ON webinar_registrations(config_id);
CREATE INDEX IF NOT EXISTS idx_webinar_registrations_email ON webinar_registrations(guest_email);

-- ── Trigger pra updated_at automático ───────────────────────
CREATE OR REPLACE FUNCTION webinar_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_webinar_configs_updated_at ON webinar_configs;
CREATE TRIGGER trg_webinar_configs_updated_at
  BEFORE UPDATE ON webinar_configs
  FOR EACH ROW EXECUTE FUNCTION webinar_set_updated_at();

DROP TRIGGER IF EXISTS trg_webinar_sessions_updated_at ON webinar_sessions;
CREATE TRIGGER trg_webinar_sessions_updated_at
  BEFORE UPDATE ON webinar_sessions
  FOR EACH ROW EXECUTE FUNCTION webinar_set_updated_at();

-- ── RLS: tudo é gerenciado pelo backend com service_role ────
-- Não habilita RLS porque o backend usa service_role e faz gate via middleware.
-- Igual ao team_scheduling_config / team_bookings.

-- ── Verificação ─────────────────────────────────────────────
-- Para validar manualmente após executar:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name LIKE 'webinar_%';
