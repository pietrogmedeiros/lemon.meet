import { useEffect, useState, useCallback } from 'react';
import { MainLayout } from '../components/layout/MainLayout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Webhook, CheckCircle, XCircle, Trash2, Zap, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface WebhookConfig {
  id: string;
  url: string;
  active: boolean;
  created_at: string;
}

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function IntegrationsPage() {
  const [webhook, setWebhook] = useState<WebhookConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/integrations/webhook`, { headers });
      if (res.ok) {
        const data = await res.json();
        setWebhook(data.webhook);
        if (data.webhook?.url) setUrlInput(data.webhook.url);
      }
    } catch {}
    finally { setIsLoading(false); }
  }, [getAuthHeader]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaveError('');
    if (!urlInput.trim()) { setSaveError('Informe a URL do webhook.'); return; }
    try { new URL(urlInput.trim()); } catch { setSaveError('URL inválida.'); return; }

    setSaving(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/integrations/webhook`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setWebhook(data.webhook);
      } else {
        const err = await res.json();
        setSaveError(err.message ?? 'Erro ao salvar.');
      }
    } catch { setSaveError('Erro de rede.'); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    const testUrl = urlInput.trim() || webhook?.url;
    if (!testUrl) return;
    setTestStatus('loading');
    setTestMessage('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/integrations/webhook/test`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: testUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage(`Webhook respondeu com status ${data.statusCode}. Tudo certo!`);
      } else {
        setTestStatus('error');
        setTestMessage(data.message ?? 'O webhook não respondeu corretamente.');
      }
    } catch {
      setTestStatus('error');
      setTestMessage('Erro de rede ao testar o webhook.');
    }
    setTimeout(() => setTestStatus('idle'), 6000);
  };

  const handleToggle = async () => {
    if (!webhook) return;
    setToggling(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/integrations/webhook/toggle`, {
        method: 'PATCH',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setWebhook(data.webhook);
      }
    } catch {}
    finally { setToggling(false); }
  };

  const handleDelete = async () => {
    if (!webhook) return;
    if (!window.confirm('Remover a configuração do webhook?')) return;
    setDeleting(true);
    try {
      const headers = await getAuthHeader();
      await fetch(`${apiUrl}/api/integrations/webhook`, { method: 'DELETE', headers });
      setWebhook(null);
      setUrlInput('');
    } catch {}
    finally { setDeleting(false); }
  };

  const PAYLOAD_EXAMPLE = `{
  "event": "meeting.completed",
  "timestamp": "2026-04-12T15:30:00Z",
  "meeting": {
    "id": "uuid",
    "title": "Reunião com João",
    "platform": "google_meet",
    "duration_seconds": 1800
  },
  "insights": {
    "sentiment": "positive",
    "commercialQuality": 8,
    "closingProbability": 72,
    "followUpSuggestions": ["Olá João, ..."],
    "actionItems": ["Enviar proposta até sexta"],
    "bantScore": { ... }
  }
}`;

  return (
    <MainLayout>
      <div className="space-y-6 max-w-3xl">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a1a]">Integrações</h1>
          <p className="mt-1 text-sm text-[#666]">
            Configure integrações externas para automatizar seu fluxo de vendas.
          </p>
        </div>

        {/* Webhook Card */}
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center flex-shrink-0">
              <Webhook className="h-5 w-5 text-[#2D5A27]" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-[#1a1a1a]">Webhook de Reunião Concluída</h2>
              <p className="text-[13px] text-[#666]">
                Receba os dados e follow-ups automaticamente assim que uma reunião for processada.
              </p>
            </div>
            {webhook && (
              <span className={`ml-auto flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                webhook.active
                  ? 'bg-[#2D5A27]/10 text-[#2D5A27]'
                  : 'bg-[#E0E0E0] text-[#888]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${webhook.active ? 'bg-[#2D5A27]' : 'bg-[#aaa]'}`} />
                {webhook.active ? 'Ativo' : 'Inativo'}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#999] py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2D5A27] border-r-transparent" />
              Carregando…
            </div>
          ) : (
            <div className="space-y-4">
              {/* URL input */}
              <div>
                <label className="block text-[13px] font-medium text-[#333] mb-1.5">
                  URL do Endpoint
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={e => { setUrlInput(e.target.value); setSaveError(''); }}
                    placeholder="https://sua-api.com/webhooks/lemon"
                    className="flex-1 px-3 py-2 text-sm border border-[#E0E0E0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/30 focus:border-[#2D5A27] transition-colors"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTest}
                    disabled={testStatus === 'loading' || !urlInput.trim()}
                    className="flex items-center gap-1.5 flex-shrink-0"
                  >
                    {testStatus === 'loading' ? (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Testar
                  </Button>
                </div>
                {saveError && (
                  <p className="mt-1.5 text-[12px] text-[#DC3545] flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />{saveError}
                  </p>
                )}
              </div>

              {/* Test feedback */}
              {testStatus !== 'idle' && testStatus !== 'loading' && (
                <div className={`flex items-center gap-2 text-[13px] px-3 py-2.5 rounded-lg ${
                  testStatus === 'success'
                    ? 'bg-[#2D5A27]/8 text-[#2D5A27]'
                    : 'bg-[#DC3545]/8 text-[#DC3545]'
                }`}>
                  {testStatus === 'success'
                    ? <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    : <XCircle className="h-4 w-4 flex-shrink-0" />}
                  {testMessage}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={saving || !urlInput.trim()}
                  size="sm"
                  className="flex items-center gap-1.5"
                >
                  {saving
                    ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    : null}
                  {webhook ? 'Atualizar URL' : 'Salvar Webhook'}
                </Button>

                {webhook && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleToggle}
                      disabled={toggling}
                    >
                      {webhook.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="ml-auto text-[#DC3545]/70 hover:text-[#DC3545] transition-colors"
                      title="Remover webhook"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Payload example */}
        <Card className="p-6">
          <h3 className="text-[14px] font-semibold text-[#1a1a1a] mb-3">Exemplo de Payload</h3>
          <pre className="bg-[#F8F9FA] border border-[#E0E0E0] rounded-lg p-4 text-[12px] text-[#444] leading-relaxed overflow-x-auto font-mono">
            {PAYLOAD_EXAMPLE}
          </pre>
          <p className="mt-3 text-[12px] text-[#888]">
            O payload é enviado via <code className="bg-[#F0F0F0] px-1 py-0.5 rounded text-[11px]">POST</code> com{' '}
            <code className="bg-[#F0F0F0] px-1 py-0.5 rounded text-[11px]">Content-Type: application/json</code>.
            O cabeçalho <code className="bg-[#F0F0F0] px-1 py-0.5 rounded text-[11px]">X-Lemon-Webhook</code> identifica a origem.
          </p>
        </Card>

      </div>
    </MainLayout>
  );
}
