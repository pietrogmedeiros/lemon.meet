import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export function PrivacyPolicyPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background dark:bg-gray-900">
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

        <h1 className="text-3xl font-bold text-primary dark:text-white mb-2">Política de Privacidade</h1>
        <p className="text-body-small text-secondary mb-10">Última atualização: abril de 2026</p>

        <div className="prose prose-sm max-w-none text-secondary dark:text-gray-300 space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">1. Quem somos</h2>
            <p>
              O <strong>Lemon.meet</strong> é um serviço de transcrição e análise inteligente de reuniões. Operamos no modelo SaaS e armazenamos dados estritamente necessários para oferecer o serviço contratado.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">2. Dados que coletamos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Dados de conta:</strong> nome, endereço de e-mail e foto de perfil obtidos via autenticação Google ou cadastro direto.</li>
              <li><strong>Dados de reunião:</strong> áudio gravado durante as reuniões em que o bot é autorizado a participar, transcrições geradas automaticamente e metadados (título, duração, link da reunião).</li>
              <li><strong>Dados de calendário:</strong> eventos do Google Calendar compartilhados pelo usuário para agendamento do bot — apenas título, horário e link da videoconferência.</li>
              <li><strong>Dados de uso:</strong> logs de acesso, registros de erros e métricas de desempenho do serviço (sem identificação comportamental para fins de publicidade).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">3. Como usamos seus dados</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fornecer, operar e melhorar o serviço de transcrição e geração de insights.</li>
              <li>Autenticar sua identidade e controlar o acesso à plataforma.</li>
              <li>Enviar notificações relacionadas às suas reuniões (lembretes, conclusão de transcrição).</li>
              <li>Garantir a segurança da plataforma e prevenir usos abusivos.</li>
            </ul>
            <p className="mt-3">Não vendemos, alugamos nem compartilhamos seus dados pessoais com terceiros para fins comerciais.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">4. Compartilhamento com terceiros</h2>
            <p>Utilizamos os seguintes fornecedores para operar o serviço:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Supabase</strong> — banco de dados e autenticação (infraestrutura hospedada na AWS).</li>
              <li><strong>MeetingBaas</strong> — serviço de bot para gravação de reuniões.</li>
              <li><strong>Gladia</strong> — motor de transcrição de áudio.</li>
              <li><strong>OpenAI</strong> — geração de insights e resumos a partir das transcrições.</li>
              <li><strong>Railway / Firebase</strong> — hospedagem da aplicação.</li>
            </ul>
            <p className="mt-3">Todos os fornecedores operam sob seus próprios termos e políticas de privacidade, e são contratualmente obrigados a tratar os dados apenas para os fins do serviço.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">5. Retenção de dados</h2>
            <p>
              Seus dados são mantidos enquanto sua conta estiver ativa. Ao solicitar a exclusão da conta, todos os dados pessoais, gravações, transcrições e insights associados são removidos permanentemente em até 30 dias.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">6. Segurança</h2>
            <p>
              Utilizamos criptografia em trânsito (TLS/HTTPS) e em repouso para todos os dados sensíveis. O acesso ao banco de dados é controlado por políticas de Row-Level Security (RLS), garantindo que cada usuário acesse apenas seus próprios dados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">7. Seus direitos (LGPD)</h2>
            <p>Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem direito a:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Confirmar a existência de tratamento dos seus dados.</li>
              <li>Acessar seus dados a qualquer momento.</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
              <li>Solicitar a exclusão dos seus dados pessoais.</li>
              <li>Revogar o consentimento dado a qualquer momento.</li>
            </ul>
            <p className="mt-3">Para exercer esses direitos, entre em contato: <strong>contato@lemon.meet</strong></p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">8. Cookies</h2>
            <p>
              Utilizamos apenas cookies estritamente necessários para autenticação e manutenção de sessão. Não utilizamos cookies de rastreamento ou publicidade.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">9. Alterações nesta política</h2>
            <p>
              Podemos atualizar esta política periodicamente. Notificaremos os usuários sobre mudanças significativas por e-mail ou via aviso na plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">10. Contato</h2>
            <p>
              Dúvidas sobre esta política? Fale conosco:<br />
              <strong>contato@lemon.meet</strong>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
