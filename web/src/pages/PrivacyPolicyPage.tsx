import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export function PrivacyPolicyPage() {
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

        <h1 className="text-3xl font-bold text-primary dark:text-white mb-2">Política de Privacidade</h1>
        <p className="text-body-small text-secondary mb-10">Última atualização: agosto de 2026</p>

        <div className="prose prose-sm max-w-none text-secondary  space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">1. Quem somos</h2>
            <p>
              O <strong>Lemon.meet</strong> é um serviço de transcrição e análise inteligente de reuniões. Operamos no modelo SaaS e armazenamos dados estritamente necessários para oferecer o serviço contratado.
            </p>
            <p className="mt-3">
              O serviço é acessado por três caminhos, todos ligados à mesma conta: o <strong>site (app web)</strong>, o <strong>app para Mac</strong> e o <strong>app para iPhone</strong>. Esta política vale para os três. O item 3 trata especificamente da gravação de reuniões presenciais pelo app do celular, que é a única parte do serviço que usa o microfone do seu aparelho.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">2. Dados que coletamos</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Dados de conta:</strong> nome, endereço de e-mail e foto de perfil obtidos via autenticação Google ou cadastro direto.</li>
              <li><strong>Áudio de reuniões:</strong> o áudio das reuniões online em que o bot é autorizado a participar e o áudio das reuniões presenciais que você grava pelo app do celular.</li>
              <li><strong>Transcrições e insights:</strong> o texto gerado a partir do áudio e as análises produzidas a partir desse texto (resumo, objeções, sentimento, próximos passos).</li>
              <li><strong>Metadados de reunião:</strong> título, data, duração, link da reunião e e-mails de participantes que você informar.</li>
              <li><strong>Dados de calendário:</strong> eventos do Google Calendar compartilhados pelo usuário para agendamento do bot — apenas título, horário e link da videoconferência.</li>
              <li><strong>Dados de uso:</strong> logs de acesso, registros de erros e métricas de desempenho do serviço (sem identificação comportamental para fins de publicidade).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">3. App para iPhone: gravação de reuniões presenciais</h2>
            <p>
              O app do Lemon.meet para iPhone é mais um caminho de acesso à sua conta: mesmo login, mesmas reuniões que você vê no site. A diferença é que ele grava <strong>reuniões presenciais</strong> pelo microfone do aparelho.
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">A gravação só começa quando você manda</h3>
            <p>
              Não existe gravação automática. O app não grava sozinho, nem em segundo plano, sem que você tenha iniciado a gravação: é preciso abrir a tela de gravação e tocar em gravar. A gravação termina quando você a encerra ou descarta.
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">Permissão de microfone</h3>
            <p>
              Na primeira gravação, o iPhone pergunta se o Lemon.meet pode usar o microfone. Sem essa autorização, o app não grava. Você pode revogá-la quando quiser em <strong>Ajustes › Lemon.meet › Microfone</strong>; a partir daí, novas gravações ficam bloqueadas até você conceder a permissão de novo.
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">Para onde o áudio vai</h3>
            <p>
              Quando você encerra a gravação, o arquivo de áudio é enviado para o servidor do Lemon.meet. Lá ele é transcrito automaticamente e, em seguida, a transcrição é usada para gerar os insights. Esses dois passos são feitos por fornecedores fora do Brasil — veja o item 7.
            </p>
            <p className="mt-3">
              Até o servidor confirmar o recebimento, o arquivo fica guardado no próprio aparelho — é isso que permite gravar sem internet e enviar depois. Confirmado o envio, o arquivo é apagado do celular.
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">O que é descartado e o que fica</h3>
            <p>
              <strong>O arquivo de áudio da reunião presencial é apagado do nosso servidor assim que o processamento termina</strong> — tanto quando dá tudo certo quanto quando algo falha no meio do caminho. Não guardamos esse áudio nem disponibilizamos link para ouvi-lo depois.
            </p>
            <p className="mt-3">
              <strong>O que permanece na sua conta é a transcrição em texto e os insights</strong> gerados a partir dela, junto com os metadados da reunião. É esse conteúdo que você acessa no app e no site, e é ele que é apagado quando você solicita a exclusão da conta (item 8).
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">O que declaramos à Apple</h3>
            <p>
              Na ficha de privacidade do app na App Store informamos que coletamos <strong>e-mail, nome e áudio</strong>, todos vinculados à sua conta e usados apenas para o funcionamento do serviço. Nenhum desses dados é usado para rastrear você entre aplicativos ou sites, nem para publicidade.
            </p>
          </section>

          {/* DECISÃO JURÍDICA PENDENTE — seção 4.
              Escrito de forma conservadora, alinhado ao item 4 dos Termos de Uso, mas
              três pontos precisam de posição jurídica antes de virarem promessa pública:
              (a) papel do Lemon.meet sob a LGPD quanto ao áudio de terceiros (operador x controlador);
              (b) base legal do tratamento de dados de quem é gravado e não tem conta;
              (c) como um participante gravado exerce direitos (acesso/exclusão) sobre um conteúdo
                  que está dentro da conta de outra pessoa. */}
          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">4. Gravação de outras pessoas</h2>
            <p>
              Quem participa de uma reunião presencial gravada pelo app normalmente não é usuário do Lemon.meet e não tem como concordar com nada dentro do nosso produto. Por isso, essa responsabilidade é de quem grava:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>avisar todos os participantes, <strong>antes de começar</strong>, que a reunião será gravada e transcrita por um serviço automatizado;</li>
              <li>obter o consentimento deles e respeitar quem não concordar — inclusive deixando de gravar;</li>
              <li>respeitar as regras do local, do contrato ou da legislação aplicável, que em várias situações exigem o consentimento de todos os presentes.</li>
            </ul>
            <p className="mt-3">
              O Lemon.meet fornece a ferramenta; a decisão de gravar, e a responsabilidade por ela, são de quem inicia a gravação. Não conseguimos verificar se o aviso foi dado.
            </p>
            <p className="mt-3">
              Se você participou de uma reunião gravada por um usuário do Lemon.meet e quer saber o que foi registrado, pedir correção ou exclusão, escreva para <strong>contato@lemon.meet</strong>. Vamos avaliar o pedido junto com o usuário responsável pela gravação, que é quem controla esse conteúdo na conta dele.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">5. Como usamos seus dados</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fornecer, operar e melhorar o serviço de transcrição e geração de insights.</li>
              <li>Autenticar sua identidade e controlar o acesso à plataforma.</li>
              <li>Enviar notificações relacionadas às suas reuniões (lembretes, conclusão de transcrição).</li>
              <li>Garantir a segurança da plataforma e prevenir usos abusivos.</li>
            </ul>
            <p className="mt-3">Não vendemos, alugamos nem compartilhamos seus dados pessoais com terceiros para fins comerciais. Não usamos seu áudio, suas transcrições ou seus insights para publicidade nem para rastreamento entre aplicativos.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">6. Compartilhamento com terceiros</h2>
            <p>Utilizamos os seguintes fornecedores para operar o serviço:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Supabase</strong> — banco de dados e autenticação.</li>
              <li><strong>MeetingBaas e Skribby</strong> — bots que entram nas reuniões online para gravar e transcrever. Esses fornecedores podem usar subcontratados próprios para a transcrição.</li>
              <li><strong>Groq</strong> — transcrição automática de áudio (modelo Whisper). É por onde passa o áudio das reuniões presenciais gravadas pelo app.</li>
              <li><strong>DeepSeek</strong> — geração de insights, resumos e respostas do chat a partir do texto da transcrição.</li>
              <li><strong>Contabo</strong> — servidor onde a aplicação roda.</li>
              <li><strong>Firebase (Google)</strong> — hospedagem do site e do app web.</li>
            </ul>
            <p className="mt-3">
              Além disso, se você ativar uma integração (HubSpot, Pipedrive, Google Drive ou webhook próprio), enviamos os dados e insights das suas reuniões para o destino que você conectou. Isso só acontece por ação sua e pode ser desligado nas configurações.
            </p>
            <p className="mt-3">Todos os fornecedores operam sob seus próprios termos e políticas de privacidade, e são contratualmente obrigados a tratar os dados apenas para os fins do serviço. O item 7 explica em que país cada um deles está.</p>
          </section>

          {/* DECISÃO JURÍDICA PENDENTE — seção 7.
              Os fatos estão verificados: banco Supabase em sa-east-1 (São Paulo), servidor de
              aplicação na Contabo, na Alemanha (confirmado no painel da Contabo), áudio para
              Groq/EUA e transcrição para DeepSeek/China.
              Falta decidir com apoio jurídico a BASE LEGAL declarada para a transferência
              internacional (art. 33 da LGPD): execução de contrato, consentimento ou cláusulas
              contratuais padrão. O texto abaixo descreve a finalidade sem nomear a hipótese. */}
          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">7. Onde seus dados ficam e para onde são enviados</h2>
            <p>
              Este item vale para o produto inteiro — site, app para Mac e app para iPhone, reuniões online e presenciais.
            </p>
            <p className="mt-3">
              São duas coisas diferentes, e vale separá-las: <strong>onde seus dados ficam guardados</strong> e <strong>para onde eles são enviados durante o processamento</strong>.
            </p>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">Onde seus dados ficam guardados</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Banco de dados — Supabase, na região de São Paulo, no Brasil.</strong> É onde ficam a sua conta, as transcrições, os insights e os metadados das suas reuniões. Os seus dados repousam em território brasileiro.</li>
              <li><strong>Servidor de aplicação — Contabo, na Alemanha.</strong> É o servidor que recebe os envios, executa o processamento e responde ao app. Os dados passam por ele, mas não é ali que ficam guardados: o áudio de uma reunião presencial fica nesse servidor apenas durante o processamento e é apagado logo em seguida (item 3).</li>
              <li><strong>Site e app web — Firebase (Google).</strong> Hospedam as páginas do produto.</li>
            </ul>

            <h3 className="text-base font-semibold text-primary dark:text-white mt-5 mb-2">Para onde seus dados são enviados durante o processamento</h3>
            <p>
              Cada reunião passa por dois fornecedores fora do Brasil. É um envio para processamento — os dados vão, são processados e voltam:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Transcrição do áudio — Groq, nos Estados Unidos.</strong> O arquivo de áudio é enviado e volta convertido em texto.</li>
              <li><strong>Insights e chat sobre a reunião — DeepSeek, na China.</strong> O texto da transcrição é enviado e volta em forma de resumo, objeções, próximos passos e respostas às suas perguntas.</li>
            </ul>
            <p className="mt-3">
              Terminado esse caminho, <strong>o áudio da reunião presencial é descartado</strong> e o que permanece guardado — no banco em São Paulo — é a transcrição e os insights.
            </p>
            <p className="mt-3">
              Fazemos esses envios porque eles são necessários para executar o serviço que você contratou: sem esses fornecedores não existe transcrição nem insights. Ao usar o Lemon.meet, você fica ciente de que o áudio e as transcrições das suas reuniões saem do Brasil para esse processamento.
            </p>
            <p className="mt-3">
              Se o conteúdo das suas reuniões for sensível a ponto de isso ser um problema — por política da sua empresa, por sigilo contratual ou por qualquer outro motivo —, não use o serviço para gravá-las.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">8. Retenção de dados</h2>
            <p>
              Seus dados são mantidos enquanto sua conta estiver ativa. O áudio das reuniões presenciais é a exceção: ele é apagado do servidor logo após o processamento, como descrito no item 3.
            </p>
            <p className="mt-3">
              Ao solicitar a exclusão da conta, todos os dados pessoais, transcrições e insights associados são removidos permanentemente em até 30 dias. O pedido pode ser feito pelo e-mail <strong>contato@lemon.meet</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">9. Segurança</h2>
            <p>
              Utilizamos criptografia em trânsito (TLS/HTTPS) e em repouso para todos os dados sensíveis. O acesso ao banco de dados é controlado por políticas de Row-Level Security (RLS), garantindo que cada usuário acesse apenas seus próprios dados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">10. Seus direitos (LGPD)</h2>
            <p>Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você tem direito a:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Confirmar a existência de tratamento dos seus dados.</li>
              <li>Acessar seus dados a qualquer momento.</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados.</li>
              <li>Solicitar a exclusão dos seus dados pessoais.</li>
              <li>Obter informação sobre com quem compartilhamos seus dados, inclusive no exterior.</li>
              <li>Revogar o consentimento dado a qualquer momento.</li>
            </ul>
            <p className="mt-3">Para exercer esses direitos, entre em contato: <strong>contato@lemon.meet</strong></p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">11. Cookies</h2>
            <p>
              Utilizamos apenas cookies estritamente necessários para autenticação e manutenção de sessão. Não utilizamos cookies de rastreamento ou publicidade.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">12. Alterações nesta política</h2>
            <p>
              Podemos atualizar esta política periodicamente. Notificaremos os usuários sobre mudanças significativas por e-mail ou via aviso na plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-primary dark:text-white mb-3">13. Contato</h2>
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
