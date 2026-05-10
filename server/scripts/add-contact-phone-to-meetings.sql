-- Adiciona campo contact_phone para armazenar telefone do contato da reunião
-- Formato: DDI+DD+TELEFONE (ex: 5511999999999)
ALTER TABLE meetings
ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

-- Adiciona índice para melhorar performance de consultas
CREATE INDEX IF NOT EXISTS idx_meetings_contact_phone ON meetings(contact_phone) WHERE contact_phone IS NOT NULL;

-- Comentário descritivo
COMMENT ON COLUMN meetings.contact_phone IS 'Telefone do contato principal da reunião no formato internacional (DDI+DD+TELEFONE). Pode ser obtido via integração HubSpot/Pipedrive ou inserido manualmente.';
