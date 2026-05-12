-- ================================================================
-- Migration: Sistema de Notificações
-- Cria tabela para armazenar notificações dos usuários
-- ================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'meeting_no_transcription', 'meeting_completed', etc
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- RLS policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas suas notificações
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Usuário pode marcar suas notificações como lidas
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Comentário
COMMENT ON TABLE notifications IS 'Notificações do sistema para cada usuário';
COMMENT ON COLUMN notifications.type IS 'Tipo da notificação (meeting_no_transcription, meeting_completed, etc)';
COMMENT ON COLUMN notifications.read IS 'Se a notificação foi lida pelo usuário';
