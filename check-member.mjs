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

console.log('🔍 Verificando membros do time CS...\n')

// Busca o time CS
const { data: team } = await supabase
  .from('teams')
  .select('*')
  .eq('name', 'Cs')
  .single()

if (!team) {
  console.log('❌ Time "Cs" não encontrado')
  process.exit(1)
}

console.log(`✅ Time encontrado: ${team.name} (${team.id})`)
console.log(`   Owner: ${team.owner_id}\n`)

// Busca todos os membros deste time
const { data: members } = await supabase
  .from('team_members')
  .select('*')
  .eq('team_id', team.id)
  .order('created_at', { ascending: false })

console.log(`📋 Total de membros: ${members?.length ?? 0}\n`)

if (members && members.length > 0) {
  for (const member of members) {
    console.log(`───────────────────────────────────────`)
    console.log(`Email: ${member.invited_email}`)
    console.log(`User ID: ${member.user_id ?? '(não vinculado)'}`)
    console.log(`Status: ${member.status}`)
    console.log(`Role: ${member.role}`)
    console.log(`Criado em: ${member.created_at}`)
  }
  console.log(`───────────────────────────────────────\n`)
}

// Procura especificamente pelo email mencionado
const { data: specificMember } = await supabase
  .from('team_members')
  .select('*')
  .eq('team_id', team.id)
  .eq('invited_email', 'pietrogmedeiros01@gmail.com')
  .maybeSingle()

if (specificMember) {
  console.log(`🎯 Membro pietrogmedeiros01@gmail.com:`)
  console.log(JSON.stringify(specificMember, null, 2))
} else {
  console.log(`❌ pietrogmedeiros01@gmail.com NÃO encontrado no time`)
}

// Verifica se o usuário existe no auth
const { data: users } = await supabase.auth.admin.listUsers()
const user = users?.users?.find(u => u.email === 'pietrogmedeiros01@gmail.com')

if (user) {
  console.log(`\n✅ Usuário existe no Auth:`)
  console.log(`   ID: ${user.id}`)
  console.log(`   Email: ${user.email}`)
  console.log(`   Confirmado: ${user.email_confirmed_at ? 'Sim' : 'Não'}`)
} else {
  console.log(`\n❌ Usuário NÃO existe no Supabase Auth`)
}
