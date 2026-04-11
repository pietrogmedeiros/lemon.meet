-- ========================================
-- LEMON.MEET - MIGRATION: EXTENSÃO CHROME
-- ========================================
-- Execute este script no SQL Editor do Supabase
-- Dashboard > SQL Editor > New Query > Cole e Execute
-- ========================================

-- ========================================
-- 1. CRIAR TABELA meetings (completa)
-- Inclui colunas originais + novas colunas
-- para suporte à extensão Chrome
-- ========================================

-- Função de updated_at (necessária antes dos triggers)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS meetings (
  -- Colunas originais
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meet_link           TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'recording', 'processing', 'completed', 'error')),
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  transcript          TEXT,
  insights            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Novas colunas (extensão Chrome)
  title               TEXT,
  platform            TEXT        DEFAULT 'google_meet'
    CHECK (platform IN ('google_meet', 'zoom', 'teams', 'meet')),
  source              TEXT        DEFAULT 'extension'
    CHECK (source IN ('extension', 'bot')),
  duration_seconds    INTEGER,
  participants_count  INTEGER,
  language            TEXT        DEFAULT 'pt',
  recording_url       TEXT
);

-- Para quem já tem a tabela, adiciona apenas as colunas novas
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'google_meet',
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'extension',
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS participants_count INTEGER,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'pt',
  ADD COLUMN IF NOT EXISTS recording_url TEXT;

-- Habilita RLS
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own meetings"   ON meetings;
DROP POLICY IF EXISTS "Users can insert their own meetings" ON meetings;
DROP POLICY IF EXISTS "Users can update their own meetings" ON meetings;
DROP POLICY IF EXISTS "Users can delete their own meetings" ON meetings;

CREATE POLICY "Users can view their own meetings"
  ON meetings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own meetings"
  ON meetings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meetings"
  ON meetings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own meetings"
  ON meetings FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS update_meetings_updated_at ON meetings;
CREATE TRIGGER update_meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índices
CREATE INDEX IF NOT EXISTS idx_meetings_user_id      ON meetings(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status        ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at    ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_user_created  ON meetings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_platform      ON meetings(platform);
CREATE INDEX IF NOT EXISTS idx_meetings_source        ON meetings(source);

-- ========================================
-- 2. CRIAR TABELA transcript_segments
-- Armazena cada segmento de fala com
-- timestamp, permitindo exibição linha a
-- linha como no TLDV/Fireflies
-- ========================================

CREATE TABLE IF NOT EXISTS transcript_segments (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   UUID    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text         TEXT    NOT NULL,
  start_seconds FLOAT  NOT NULL,
  end_seconds   FLOAT  NOT NULL,
  speaker      TEXT,                          -- "Speaker 1", "Speaker 2" (diarização futura)
  sequence     INTEGER NOT NULL DEFAULT 0,    -- Ordem de exibição
  chunk_index  INTEGER NOT NULL DEFAULT 0,    -- Qual chunk de áudio gerou este segmento
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice principal: buscar segmentos de uma reunião em ordem
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_id
  ON transcript_segments(meeting_id, sequence ASC);

-- Índice para busca por speaker (futuro)
CREATE INDEX IF NOT EXISTS idx_transcript_segments_speaker
  ON transcript_segments(meeting_id, speaker);

-- ========================================
-- 3. HABILITAR RLS NA transcript_segments
-- ========================================

ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view segments of their meetings" ON transcript_segments;
DROP POLICY IF EXISTS "Service role can insert segments" ON transcript_segments;
DROP POLICY IF EXISTS "Service role can delete segments" ON transcript_segments;

-- Usuários só veem segmentos de reuniões deles
CREATE POLICY "Users can view segments of their meetings"
  ON transcript_segments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_segments.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- Apenas o service role (backend) pode inserir segmentos
CREATE POLICY "Service role can insert segments"
  ON transcript_segments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_segments.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- Usuários podem deletar segmentos de reuniões deles
CREATE POLICY "Service role can delete segments"
  ON transcript_segments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = transcript_segments.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- ========================================
-- 4. TRIGGER updated_at para transcript_segments
-- (reutiliza função já criada no setup inicial)
-- ========================================

-- Adiciona coluna updated_at (opcional, para edições futuras nos segmentos)
ALTER TABLE transcript_segments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS update_transcript_segments_updated_at ON transcript_segments;

CREATE TRIGGER update_transcript_segments_updated_at
  BEFORE UPDATE ON transcript_segments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 5. STORAGE BUCKET para áudios
-- ========================================

-- Cria bucket privado para armazenar gravações de áudio
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'meeting-recordings',
  'meeting-recordings',
  false,                   -- privado: acesso apenas via signed URL
  524288000,               -- 500MB por arquivo
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

-- Política: usuários só acessam seus próprios áudios
-- (caminho: {user_id}/{meeting_id}.webm)
DROP POLICY IF EXISTS "Users can upload their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON storage.objects;

CREATE POLICY "Users can upload their own recordings"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'meeting-recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read their own recordings"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'meeting-recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own recordings"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'meeting-recordings'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ========================================
-- 6. VERIFICAÇÃO
-- ========================================

SELECT 'meetings colunas' AS check, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'meetings'
  AND column_name IN ('title', 'platform', 'source', 'duration_seconds', 'participants_count', 'language', 'recording_url')
ORDER BY column_name;

SELECT 'transcript_segments' AS check,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'transcript_segments') AS tabela_criada;

SELECT 'storage bucket' AS check,
  EXISTS(SELECT 1 FROM storage.buckets WHERE id = 'meeting-recordings') AS bucket_criado;
