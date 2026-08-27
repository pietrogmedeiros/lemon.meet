// reprocess-insights.ts — regera insights de reuniões que têm transcrição mas
// ficaram sem análise (tipicamente `insights_generation_failed`).
//
// POR QUE EXISTE: o endpoint POST /api/meetings/:id/reprocess-insights exige o JWT
// do dono da reunião, e a UI NÃO tem botão que o chame — a tela de erro diz "Tente
// reprocessar" e não oferece como. Enquanto esse botão não existir, isto roda pelo
// operador com a service_role. Usa o MESMO InsightsService da produção, para o
// resultado ser idêntico ao do fluxo normal.
//
// Uso:
//   npx tsx scripts/reprocess-insights.ts <meetingId> [<meetingId> ...]
//   npx tsx scripts/reprocess-insights.ts --pendentes
//
// ⚠️ Consome saldo do DeepSeek. Confira antes:
//   curl -s https://api.deepseek.com/user/balance -H "Authorization: Bearer $DEEPSEEK_API_KEY"

import 'dotenv/config'
import { supabase } from '../src/config/supabase.js'
import { insightsService } from '../src/services/InsightsService.js'

type Row = { id: string; title: string | null; transcript: string | null }

async function alvos(args: string[]): Promise<Row[]> {
  if (args.includes('--pendentes')) {
    const { data, error } = await supabase
      .from('meetings')
      .select('id, title, transcript')
      .eq('status', 'completed')
      .is('insights', null)
      .not('transcript', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(`falha ao listar pendentes: ${error.message}`)
    return (data ?? []) as Row[]
  }

  const ids = args.filter((a) => !a.startsWith('--'))
  if (!ids.length) {
    console.error('Informe ao menos um meetingId, ou use --pendentes.')
    process.exit(1)
  }
  const { data, error } = await supabase
    .from('meetings')
    .select('id, title, transcript')
    .in('id', ids)
  if (error) throw new Error(`falha ao carregar reuniões: ${error.message}`)
  return (data ?? []) as Row[]
}

async function main() {
  const rows = await alvos(process.argv.slice(2))
  if (!rows.length) return console.log('Nada a reprocessar.')

  console.log(`${rows.length} reunião(ões) a reprocessar:\n`)
  let ok = 0
  for (const m of rows) {
    const nome = (m.title ?? m.id).slice(0, 46)
    if (!m.transcript?.trim()) {
      console.log(`  PULADA   ${nome} — sem transcrição`)
      continue
    }
    process.stdout.write(`  ...      ${nome} (${m.transcript.length} chars) `)
    try {
      const insights = await insightsService.generateInsights(m.transcript, m.id)
      // failure_reason volta a null: o erro que marcou a reunião deixou de valer.
      const { error } = await supabase
        .from('meetings')
        .update({ insights, status: 'completed', failure_reason: null })
        .eq('id', m.id)
      if (error) throw new Error(error.message)
      console.log('OK')
      ok++
    } catch (err) {
      console.log(`FALHOU — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`\n${ok}/${rows.length} reprocessada(s) com sucesso.`)
}

main().catch((err) => {
  console.error('erro fatal:', err)
  process.exit(1)
})
