import {
  donoPeloPapel,
  ehCoDonoPorMetadata,
  ehEmailPrivado,
  removerContasPrivadas,
  PAPEIS_ELEVADOS,
} from './teamAccess.js'

const PIETRO = '6d384868-1898-460a-8533-b3142078b159'
const HESLEY = '87dc4155-3d34-4152-9bd5-49e060ae7f8d'
const DEBORA = '3e9b5f9f-0bf7-4386-8c78-50c3b4cc4816'

describe('donoPeloPapel — co-dono manda igual ao dono da linha', () => {
  it('o dono da linha `teams.owner_id` manda, com qualquer papel', () => {
    expect(donoPeloPapel(PIETRO, PIETRO, 'admin')).toBe(true)
    expect(donoPeloPapel(PIETRO, PIETRO, 'member')).toBe(true)
    expect(donoPeloPapel(PIETRO, PIETRO, null)).toBe(true)
  })

  it('o papel `owner` em team_members vale como dono', () => {
    // O caso real: `teams.owner_id` é coluna ÚNICA e não cabe o Hesley. Ele
    // precisa editar o time, convidar e promover admin igual ao Pietro.
    expect(donoPeloPapel(PIETRO, HESLEY, 'owner')).toBe(true)
  })

  it('admin NÃO é dono — admin vê o time, não manda nele', () => {
    expect(donoPeloPapel(PIETRO, HESLEY, 'admin')).toBe(false)
    expect(donoPeloPapel(PIETRO, DEBORA, 'member')).toBe(false)
    expect(donoPeloPapel(PIETRO, DEBORA, undefined)).toBe(false)
  })

  it('time sem dono não promove ninguém', () => {
    expect(donoPeloPapel(null, HESLEY, 'admin')).toBe(false)
    expect(donoPeloPapel(undefined, HESLEY, 'member')).toBe(false)
  })

  it('papel elevado (visão do time inteiro) inclui admin E owner', () => {
    // Se isto virar só ['admin'], promover alguém a co-dono o REBAIXA: ele
    // perde a visão das reuniões do time que tinha como admin.
    expect([...PAPEIS_ELEVADOS]).toEqual(['admin', 'owner'])
  })
})

describe('contas privadas — as calls do Pietro não são do cliente', () => {
  it('reconhece a conta pessoal', () => {
    expect(ehEmailPrivado('pietrogoncalvesmedeiros@gmail.com')).toBe(true)
    expect(ehEmailPrivado('  PietroGoncalvesMedeiros@Gmail.com ')).toBe(true)
    expect(ehEmailPrivado('hesley.nascimento@starbem.app')).toBe(false)
    expect(ehEmailPrivado(null)).toBe(false)
    expect(ehEmailPrivado(undefined)).toBe(false)
  })

  it('esconde a conta privada de quem pergunta de fora', () => {
    // Hesley é co-dono: vê o time inteiro, menos as reuniões do Pietro.
    expect(removerContasPrivadas([PIETRO, HESLEY, DEBORA], [PIETRO], HESLEY))
      .toEqual([HESLEY, DEBORA])
  })

  it('o dono da conta continua vendo as próprias reuniões', () => {
    expect(removerContasPrivadas([PIETRO, HESLEY], [PIETRO], PIETRO))
      .toEqual([PIETRO, HESLEY])
  })

  it('sem conta privada resolvida, não mexe na lista', () => {
    // Falha transitória do Auth devolve lista vazia: melhor não esconder nada
    // do que esconder tudo e o time achar que perdeu as reuniões.
    expect(removerContasPrivadas([PIETRO, HESLEY], [], HESLEY)).toEqual([PIETRO, HESLEY])
  })
})

describe('ehCoDonoPorMetadata — o caminho que não depende de migration', () => {
  const STARBEM = '0bba0642-3959-4fd8-a50b-20a0c3c0d6a2'
  const OUTRO = '11111111-1111-1111-1111-111111111111'

  it('reconhece o time listado no metadata', () => {
    // O banco RECUSA role='owner' ("team_members_role_check"), então o co-dono
    // mora no user_metadata do Auth — gravável sem DDL.
    expect(ehCoDonoPorMetadata({ co_owner_team_ids: [STARBEM] }, STARBEM)).toBe(true)
    expect(ehCoDonoPorMetadata({ co_owner_team_ids: [OUTRO, STARBEM] }, STARBEM)).toBe(true)
  })

  it('não vaza para outro time nem para metadata vazio/estranho', () => {
    expect(ehCoDonoPorMetadata({ co_owner_team_ids: [OUTRO] }, STARBEM)).toBe(false)
    expect(ehCoDonoPorMetadata({ co_owner_team_ids: [] }, STARBEM)).toBe(false)
    expect(ehCoDonoPorMetadata({}, STARBEM)).toBe(false)
    expect(ehCoDonoPorMetadata(null, STARBEM)).toBe(false)
    expect(ehCoDonoPorMetadata(undefined, STARBEM)).toBe(false)
    // Alguém grava string em vez de lista: não promove ninguém.
    expect(ehCoDonoPorMetadata({ co_owner_team_ids: STARBEM }, STARBEM)).toBe(false)
  })
})
