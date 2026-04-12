-- ============================================================
-- Migration: meeting_action_items table
-- Next Steps Tracking feature
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para listagem por reunião
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting_id
  ON meeting_action_items (meeting_id);

-- Index para dashboard (todos os itens pendentes de um usuário)
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_user_status
  ON meeting_action_items (user_id, status);

-- RLS
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own action items"
  ON meeting_action_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
