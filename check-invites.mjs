import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔍 Verificando convites para pietrogmedeiros01@gmail.com...\n')

// Busca convites por email (qualquer time)
const { data: invites } = await supabase
  .from('team_members')
  .select('*, teams(name)')
  .eq('invited_email', 'pietrogmedeiros01@gmail.com')
  .order('created_at', { ascending: false })

if (invites && invites.length > 0) {
  console.log(`📧 ${invites.length} convite(s) encontrado(s):\n`)
  for (const invite of invites) {
    console.log(`───────────────────────────────────────`)
    console.log(`Time: ${invite.teams.name}`)
    console.log(`Status: ${invite.status}`)
    console.log(`User ID: ${invite.user_id ?? '(pendente)'}`)
    console.log(`Role: ${invite.role}`)
    console.log(`Criado em: ${invite.created_at}`)
    console.log(`ID: ${invite.id}`)
  }
} else {
  console.log('❌ Nenhum convite encontrado para este email')
}

// Busca links de convite do time CS
const { data: team } = await supabase
  .from('teams')
  .select('id')
  .eq('name', 'Cs')
  .single()

if (team) {
  const { data: inviteLinks } = await supabase
    .from('team_invite_links')
    .select('*')
    .eq('team_id', team.id)
    .order('created_at', { ascending: false })

  console.log(`\n🔗 Links de convite do time CS: ${inviteLinks?.length ?? 0}`)
  
  if (inviteLinks && inviteLinks.length > 0) {
    for (const link of inviteLinks) {
      console.log(`\n───────────────────────────────────────`)
      console.log(`Token: ${link.token}`)
      console.log(`Ativo: ${link.is_active}`)
      console.log(`Expira em: ${link.expires_at}`)
      console.log(`Usos: ${link.current_uses} / ${link.max_uses ?? '∞'}`)
      console.log(`Criado em: ${link.created_at}`)
    }
  }
}

console.log('\n')
