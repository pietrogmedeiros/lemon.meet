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

// Badge de severidade (classes literais p/ Tailwind JIT enxergar), com dark.
const SEV = {
  high:   { label: 'Alto',  pill: 'bg-[#FDE3E0] text-[#B42318] dark:bg-[#3A1C1A] dark:text-[#F0857B]' },
  medium: { label: 'Médio', pill: 'bg-[#FCEFD3] text-[#B25E00] dark:bg-[#33260F] dark:text-[#E0A85C]' },
  low:    { label: 'Baixo', pill: 'bg-[#E3F0E4] text-[#2D7A34] dark:bg-[#16291B] dark:text-[#6FD17A]' },
} as const;
const SEV_ORDER = { high: 0, medium: 1, low: 2 } as const;

// Tons por coluna — classes com variante dark (o texto interno usa tokens
// text-primary/secondary, que já flipam e ficam legíveis sobre o tom escuro).
interface ColumnTint { panel: string; head: string; quote: string; badge: string }
const TINT = {
  pros: {
    panel: 'bg-[#F4FBF4] border-[#DCEFDC] dark:bg-[#13251A] dark:border-[#244A2F]',
    head: 'text-[#2D7A34] dark:text-[#6FD17A]',
    quote: 'border-[#BCE0BC] dark:border-[#2E5A37]',
    badge: 'bg-[#DCEFDC] text-[#2D7A34] dark:bg-[#1C3B24] dark:text-[#6FD17A]',
  },
  cons: {
    panel: 'bg-[#FFFAF0] border-[#F2E4C9] dark:bg-[#241E12] dark:border-[#4A3E22]',
    head: 'text-[#B25E00] dark:text-[#E0A85C]',
    quote: 'border-[#EBD3A6] dark:border-[#5A4A2A]',
    badge: 'bg-[#F2E4C9] text-[#B25E00] dark:bg-[#3A2F18] dark:text-[#E0A85C]',
  },
  risks: {
    panel: 'bg-[#FEF6F5] border-[#F6DDDA] dark:bg-[#2A1716] dark:border-[#4A2E2C]',
    head: 'text-[#B42318] dark:text-[#F0857B]',
    quote: 'border-[#F6DDDA] dark:border-[#4A2E2C]',
    badge: 'bg-[#F6DDDA] text-[#B42318] dark:bg-[#3A1C1A] dark:text-[#F0857B]',
  },
} satisfies Record<string, ColumnTint>;

/** Painel de uma coluna (A favor / Contra), com tom suave (claro/dark). */
function PointColumn({
  title, icon, count, tint, items,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  tint: ColumnTint;
  items: DecisionPoint[];
}) {
  return (
    <div className={`rounded-xl border p-4 ${tint.panel}`}>
      <h3 className={`flex items-center gap-1.5 text-sm font-semibold mb-3 ${tint.head}`}>
        {icon}
        {title}
        <span className={`ml-auto text-xs font-medium rounded-full px-2 py-0.5 ${tint.badge}`}>
          {count}
        </span>
      </h3>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((p, i) => (
            <li key={i}>
              <p className="text-sm text-primary font-medium leading-snug">{p.point}</p>
              {p.evidence && (
                <p className={`mt-1 text-xs text-secondary italic leading-relaxed border-l-2 pl-2 ${tint.quote}`}>
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
          tint={TINT.pros}
          items={ds.pros ?? []}
        />

        <PointColumn
          title="Contra"
          icon={<ThumbsDown className="h-4 w-4" />}
          count={ds.cons?.length ?? 0}
          tint={TINT.cons}
          items={ds.cons ?? []}
        />

        {/* Riscos — com badge de severidade + mitigação */}
        <div className={`rounded-xl border p-4 ${TINT.risks.panel}`}>
          <h3 className={`flex items-center gap-1.5 text-sm font-semibold mb-3 ${TINT.risks.head}`}>
            <AlertTriangle className="h-4 w-4" />
            Riscos
            <span className={`ml-auto text-xs font-medium rounded-full px-2 py-0.5 ${TINT.risks.badge}`}>
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
