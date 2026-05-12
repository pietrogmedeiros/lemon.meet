import { useState, useCallback, useEffect } from 'react';
import { Globe, Linkedin, Instagram, Sparkles, RefreshCw, Building2, User, Lightbulb, MessageCircle, Hash } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';

// ── Types ──────────────────────────────────────────────────────────────────

interface RapportCompany {
  name: string;
  description: string;
  mainProducts: string[];
  recentHighlights: string[];
  talkingPoints: string[];
}

interface RapportPerson {
  name: string;
  role: string;
  background: string;
  conversationStarters: string[];
}

interface RapportData {
  company?: RapportCompany;
  person?: RapportPerson;
  rapportTips: string[];
  iceBreakers: string[];
  suggestedTopics: string[];
}

interface MeetingRapport {
  website_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  rapport_data: RapportData | null;
}

interface RapportSectionProps {
  meetingId: string;
  initialRapport: MeetingRapport | null;
  apiUrl: string;
  getAuthHeader: () => Promise<Record<string, string>>;
}

// ── Sub-componentes de display ─────────────────────────────────────────────

function ChipList({ items, colorClass }: { items: string[]; colorClass: string }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((item, i) => (
        <span key={i} className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full font-medium ${colorClass}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-secondary leading-relaxed">
          <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary/40" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function RapportDataDisplay({ data }: { data: RapportData }) {
  return (
    <div className="space-y-5 mt-4">
      {/* Empresa */}
      {data.company && (
        <div className="rounded-lg border border-[#E8F5E9] bg-[#F9FFF9] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-primary mb-1">
            <Building2 className="h-4 w-4 text-[#2D5A27]" />
            {data.company.name}
          </h3>
          {data.company.description && (
            <p className="text-sm text-secondary leading-relaxed mb-3">{data.company.description}</p>
          )}
          {data.company.mainProducts?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-secondary uppercase tracking-wide">Produtos / Serviços</span>
              <ChipList items={data.company.mainProducts} colorClass="bg-primary/10 text-primary" />
            </div>
          )}
          {data.company.recentHighlights?.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-secondary uppercase tracking-wide">Destaques Recentes</span>
              <BulletList items={data.company.recentHighlights} />
            </div>
          )}
          {data.company.talkingPoints?.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-secondary uppercase tracking-wide">Pontos de Conversa</span>
              <BulletList items={data.company.talkingPoints} />
            </div>
          )}
        </div>
      )}

      {/* Pessoa */}
      {data.person && (
        <div className="rounded-lg border border-[#E8EEF9] bg-[#F6F9FF] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-primary mb-1">
            <User className="h-4 w-4 text-[#3B5999]" />
            {data.person.name}
            {data.person.role && (
              <span className="text-xs font-normal text-secondary">· {data.person.role}</span>
            )}
          </h3>
          {data.person.background && (
            <p className="text-sm text-secondary leading-relaxed mb-3">{data.person.background}</p>
          )}
          {data.person.conversationStarters?.length > 0 && (
            <div>
              <span className="text-xs font-medium text-secondary uppercase tracking-wide">Como começar a conversa</span>
              <BulletList items={data.person.conversationStarters} />
            </div>
          )}
        </div>
      )}

      {/* Grid: Dicas de rapport + Ice-breakers + Tópicos */}
      <div className="grid gap-4 sm:grid-cols-3">
        {data.rapportTips?.length > 0 && (
          <div className="rounded-lg border border-[#FFF3E0] bg-[#FFFBF5] p-3">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#E65100] uppercase tracking-wide mb-2">
              <Lightbulb className="h-3.5 w-3.5" />
              Dicas de Rapport
            </h4>
            <ul className="space-y-1.5">
              {data.rapportTips.map((tip, i) => (
                <li key={i} className="text-xs text-secondary leading-relaxed flex items-start gap-1.5">
                  <span className="mt-1 flex-shrink-0 w-1 h-1 rounded-full bg-[#E65100]/50" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.iceBreakers?.length > 0 && (
          <div className="rounded-lg border border-[#F3E5F5] bg-[#FDF5FF] p-3">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#7B1FA2] uppercase tracking-wide mb-2">
              <MessageCircle className="h-3.5 w-3.5" />
              Ice-breakers
            </h4>
            <ul className="space-y-1.5">
              {data.iceBreakers.map((tip, i) => (
                <li key={i} className="text-xs text-secondary leading-relaxed flex items-start gap-1.5">
                  <span className="mt-1 flex-shrink-0 w-1 h-1 rounded-full bg-[#7B1FA2]/50" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.suggestedTopics?.length > 0 && (
          <div className="rounded-lg border border-[#E3F2FD] bg-[#F3FAFF] p-3">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-[#1565C0] uppercase tracking-wide mb-2">
              <Hash className="h-3.5 w-3.5" />
              Tópicos Sugeridos
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {data.suggestedTopics.map((topic, i) => (
                <span key={i} className="text-xs bg-[#1565C0]/10 text-[#1565C0] px-2 py-0.5 rounded-full">
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────

export function RapportSection({ meetingId, initialRapport, apiUrl, getAuthHeader }: RapportSectionProps) {
  const [website, setWebsite] = useState(initialRapport?.website_url ?? '');
  const [linkedin, setLinkedin] = useState(initialRapport?.linkedin_url ?? '');
  const [instagram, setInstagram] = useState(initialRapport?.instagram_url ?? '');
  const [rapport, setRapport] = useState<MeetingRapport | null>(initialRapport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!initialRapport?.rapport_data);

  // Sincroniza quando o pai passa os dados carregados do banco
  useEffect(() => {
    setWebsite(initialRapport?.website_url ?? '');
    setLinkedin(initialRapport?.linkedin_url ?? '');
    setInstagram(initialRapport?.instagram_url ?? '');
    setRapport(initialRapport);
    setShowForm(!initialRapport?.rapport_data);
  }, [initialRapport]);

  const hasAnyUrl = website.trim() || linkedin.trim() || instagram.trim();

  const handleEnrich = useCallback(async () => {
    if (!hasAnyUrl || loading) return;
    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/api/meetings/${meetingId}/rapport/enrich`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: website.trim() || undefined,
          linkedin: linkedin.trim() || undefined,
          instagram: instagram.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'Erro ao enriquecer rapport');
        return;
      }

      setRapport(data.rapport);
      setShowForm(false);
    } catch {
      setError('Falha na conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [meetingId, website, linkedin, instagram, apiUrl, getAuthHeader, hasAnyUrl, loading]);

  return (
    <Card className="p-5 border-l-4 border-l-[#2D5A27] bg-white">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-headline-2 text-primary flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#2D5A27]" />
            Enriquecer Rapport
            <span className="ml-1 text-xs bg-[#2D5A27]/10 text-[#2D5A27] px-2 py-0.5 rounded-full font-medium">
              Pré-reunião
            </span>
            <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium border border-amber-200">
              Beta
            </span>
          </h2>
          <p className="text-xs text-gray-500 italic">
            Se você está vendo essa funcionalidade, você é especial para nós.
          </p>
        </div>

        {rapport?.rapport_data && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
        )}
      </div>

      {/* Formulário de URLs */}
      {showForm && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-[#FFFDF0] border border-[#FFE082] px-3 py-2.5">
            <span className="text-base leading-none mt-0.5">💡</span>
            <div>
              <p className="text-sm text-secondary">
                Informe ao menos uma URL. <span className="font-semibold text-primary">Quanto mais fontes, maior a assertividade</span> — combinar site da empresa + LinkedIn da pessoa gera os insights mais ricos para a conversa.
              </p>
              <div className="mt-2 flex items-center gap-3">
                {[
                  { filled: website.trim() || linkedin.trim() || instagram.trim(), label: '1 fonte' },
                  { filled: [website, linkedin, instagram].filter(s => s.trim()).length >= 2, label: '2 fontes' },
                  { filled: website.trim() && linkedin.trim() && instagram.trim(), label: '3 fontes' },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full transition-colors ${step.filled ? 'bg-[#2D5A27]' : 'bg-[#D0D0D0]'}`} />
                    <span className={`text-xs transition-colors ${step.filled ? 'text-[#2D5A27] font-medium' : 'text-[#BDBDBD]'}`}>
                      {step.label}
                    </span>
                    {i < 2 && <span className="text-[#D0D0D0] text-xs">→</span>}
                  </div>
                ))}
                <span className={`ml-1 text-xs font-semibold transition-colors ${
                  [website, linkedin, instagram].filter(s => s.trim()).length === 3
                    ? 'text-[#2D5A27]'
                    : [website, linkedin, instagram].filter(s => s.trim()).length === 2
                    ? 'text-[#F57C00]'
                    : 'text-[#BDBDBD]'
                }`}>
                  {[website, linkedin, instagram].filter(s => s.trim()).length === 3
                    ? '🎯 Máxima assertividade'
                    : [website, linkedin, instagram].filter(s => s.trim()).length === 2
                    ? '⚡ Alta assertividade'
                    : [website, linkedin, instagram].filter(s => s.trim()).length === 1
                    ? '✓ Assertividade básica'
                    : ''}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {/* Website */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Globe className="h-3.5 w-3.5" />
                Site da Empresa
              </label>
              <input
                type="url"
                placeholder="https://empresa.com"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                className="rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-sm text-primary placeholder:text-[#BDBDBD] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>

            {/* LinkedIn */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Linkedin className="h-3.5 w-3.5 text-[#0A66C2]" />
                LinkedIn
              </label>
              <input
                type="url"
                placeholder="https://linkedin.com/in/nome"
                value={linkedin}
                onChange={e => setLinkedin(e.target.value)}
                className="rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-sm text-primary placeholder:text-[#BDBDBD] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>

            {/* Instagram */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                <Instagram className="h-3.5 w-3.5 text-[#E1306C]" />
                Instagram
              </label>
              <input
                type="url"
                placeholder="https://instagram.com/perfil"
                value={instagram}
                onChange={e => setInstagram(e.target.value)}
                className="rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-sm text-primary placeholder:text-[#BDBDBD] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleEnrich}
              disabled={!hasAnyUrl || loading}
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  Buscando informações…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Enriquecer rapport
                </>
              )}
            </Button>

            {rapport?.rapport_data && (
              <button
                onClick={() => setShowForm(false)}
                className="text-sm text-secondary hover:text-primary transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Dados exibidos após enriquecimento */}
      {!showForm && rapport?.rapport_data && (
        <RapportDataDisplay data={rapport.rapport_data} />
      )}
    </Card>
  );
}
