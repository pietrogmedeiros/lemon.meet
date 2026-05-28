import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export function TermosAppPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background ">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-body-small text-secondary hover:text-primary transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>

        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.png" alt="Lemon.meet" className="h-8 w-8 object-contain" />
          <span className="font-semibold text-primary dark:text-white text-lg">Lemon.meet</span>
        </div>

        <h1 className="text-3xl font-bold text-primary dark:text-white mb-2">Termos de Uso</h1>
        <p className="text-body-small text-secondary mb-10">Última atualização: abril de 2026</p>

        <div className="prose prose-sm max-w-none text-secondary  space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">1. Aceitação dos termos</h2>
            <p>
              Ao criar uma conta ou utilizar o <strong>Lemon.meet</strong>, você declara ter lido, compreendido e concordado com estes Termos de Uso. Caso não concorde, não utilize o serviço.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">2. Descrição do serviço</h2>
            <p>
              O Lemon.meet oferece um serviço de transcrição automática, análise e geração de insights de reuniões online (Google Meet, Zoom, Microsoft Teams). O serviço opera por meio de um bot que ingressa nas reuniões mediante autorização do usuário.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">3. Uso responsável</h2>
            <p>Você se compromete a:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Obter o consentimento de todos os participantes antes de gravar uma reunião.</li>
              <li>Utilizar o serviço apenas para fins lícitos e de acordo com a legislação vigente.</li>
              <li>Não utilizar o serviço para gravar reuniões de terceiros sem autorização.</li>
              <li>Não tentar contornar medidas de segurança ou acessar dados de outros usuários.</li>
              <li>Não utilizar o serviço para gravar informações confidenciais em violação a acordos de não divulgação.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">4. Consentimento dos participantes</h2>
            <p>
              É de <strong>exclusiva responsabilidade do usuário</strong> informar e obter consentimento expresso de todos os participantes antes de iniciar a gravação de qualquer reunião. O Lemon.meet não se responsabiliza por gravações realizadas sem o devido consentimento.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">5. Planos e pagamento</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>O serviço oferece um período de teste gratuito conforme especificado no momento do cadastro.</li>
              <li>Após o período de teste, é necessária a contratação de um plano pago para continuar utilizando.</li>
              <li>Os valores dos planos são exibidos na página de assinatura e podem ser alterados mediante aviso prévio de 30 dias.</li>
              <li>Não há reembolso proporcional em caso de cancelamento antecipado, exceto quando exigido por lei.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">6. Propriedade do conteúdo</h2>
            <p>
              As transcrições e insights gerados a partir das suas reuniões são de sua propriedade. O Lemon.meet não reivindica direitos sobre o conteúdo das reuniões gravadas. Concedemos a você uma licença não exclusiva para usar a plataforma e acessar os dados gerados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">7. Limitação de responsabilidade</h2>
            <p>
              O Lemon.meet é fornecido "como está". Não garantimos que o serviço será ininterrupto ou livre de erros. A precisão das transcrições depende da qualidade do áudio e pode variar. Não nos responsabilizamos por decisões tomadas com base nos insights gerados automaticamente.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">8. Suspensão e encerramento</h2>
            <p>
              Reservamo-nos o direito de suspender ou encerrar contas que violem estes termos, sem aviso prévio em casos de uso indevido grave. O usuário pode cancelar sua conta a qualquer momento nas configurações da plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">9. Alterações nos termos</h2>
            <p>
              Podemos modificar estes termos a qualquer momento. Comunicaremos alterações relevantes por e-mail. O uso continuado do serviço após as alterações implica aceitação dos novos termos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">10. Lei aplicável</h2>
            <p>
              Estes termos são regidos pelas leis brasileiras. Fica eleito o foro da comarca de São Paulo/SP para resolução de quaisquer disputas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">11. Contato</h2>
            <p>
              Dúvidas sobre estes termos?<br />
              <strong>contato@lemon.meet</strong>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
