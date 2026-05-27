import type { ReactNode } from 'react';
import { Card } from './Card';
import { Sparkles, ThumbsUp, ThumbsDown, AlertTriangle } from 'lucide-react';

// Síntese acionável da reunião (pró / contra / risco), cada item ancorado em
// evidência. Gerada pelo InsightsService (campo decisionSummary, opcional).
export interface DecisionPoint {
  point: string;
  evidence: string;
}
export interface DecisionRisk {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation?: string;
}
export interface DecisionSummary {
  pros: DecisionPoint[];
  cons: DecisionPoint[];
  risks: DecisionRisk[];
}

// Classes literais (Tailwind JIT precisa enxergar o texto exato no fonte).
const SEV = {
  high:   { label: 'Alto',  pill: 'bg-[#FDE3E0] text-[#B42318]' },
  medium: { label: 'Médio', pill: 'bg-[#FCEFD3] text-[#B25E00]' },
  low:    { label: 'Baixo', pill: 'bg-[#E3F0E4] text-[#2D7A34]' },
} as const;
const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Painel de uma coluna (A favor / Contra), com tinta suave e evidência citada. */
function PointColumn({
  title, icon, count, tint, items,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  tint: { bg: string; border: string; head: string; quote: string };
  items: DecisionPoint[];
}) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: tint.bg, borderColor: tint.border }}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: tint.head }}>
        {icon}
        {title}
        <span className="ml-auto text-xs font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: tint.border, color: tint.head }}>
          {count}
        </span>
      </h3>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((p, i) => (
            <li key={i}>
              <p className="text-sm text-primary font-medium leading-snug">{p.point}</p>
              {p.evidence && (
                <p className="mt-1 text-xs text-secondary italic leading-relaxed border-l-2 pl-2" style={{ borderColor: tint.quote }}>
                  {p.evidence}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-secondary/60">Nada relevante.</p>
      )}
    </div>
  );
}

export function DecisionSummaryCard({ summary: ds }: { summary: DecisionSummary }) {
  if (!ds || !(ds.pros?.length || ds.cons?.length || ds.risks?.length)) return null;

  const risks = [...(ds.risks ?? [])].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  return (
    <Card className="p-5 mb-4">
      <h2 className="text-headline-2 text-primary mb-4 flex items-center gap-2">
        <Sparkles className="h-5 w-5" />
        Insights que impulsionam decisões
      </h2>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PointColumn
          title="A favor"
          icon={<ThumbsUp className="h-4 w-4" />}
          count={ds.pros?.length ?? 0}
          tint={{ bg: '#F4FBF4', border: '#DCEFDC', head: '#2D7A34', quote: '#BCE0BC' }}
          items={ds.pros ?? []}
        />

        <PointColumn
          title="Contra"
          icon={<ThumbsDown className="h-4 w-4" />}
          count={ds.cons?.length ?? 0}
          tint={{ bg: '#FFFAF0', border: '#F2E4C9', head: '#B25E00', quote: '#EBD3A6' }}
          items={ds.cons ?? []}
        />

        {/* Riscos — com badge de severidade + mitigação */}
        <div className="rounded-xl border p-4" style={{ backgroundColor: '#FEF6F5', borderColor: '#F6DDDA' }}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: '#B42318' }}>
            <AlertTriangle className="h-4 w-4" />
            Riscos
            <span className="ml-auto text-xs font-medium rounded-full px-2 py-0.5" style={{ backgroundColor: '#F6DDDA', color: '#B42318' }}>
              {risks.length}
            </span>
          </h3>
          {risks.length ? (
            <ul className="space-y-3">
              {risks.map((r, i) => {
                const sev = SEV[r.severity] ?? SEV.low;
                return (
                  <li key={i}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-primary font-medium leading-snug">{r.description}</p>
                      <span className={`flex-shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 ${sev.pill}`}>
                        {sev.label}
                      </span>
                    </div>
                    {r.mitigation && (
                      <p className="mt-1 text-xs text-secondary leading-relaxed">
                        <span className="font-medium text-primary/70">Mitigação:</span> {r.mitigation}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-secondary/60">Nenhum risco identificado.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
