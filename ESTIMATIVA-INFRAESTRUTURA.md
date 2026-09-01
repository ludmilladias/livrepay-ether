# LIVREPAY — Estimativa de infraestrutura, segurança e time para produção

> Baseado em: correspondente/reseller da Ether (não instituição regulada própria), equipe de
> 1-3 pessoas, escala esperada de "crescimento inicial" (milhares de clientes ativos,
> centenas a milhares de transações/dia), app mobile construído do zero, DigitalOcean como
> provedor de nuvem. Escopo de IA ainda não definido — tratado como placeholder de infra.

## Resumo executivo

| | |
|---|---|
| **Custo de infraestrutura (DO)** | ~R$ 1.800–4.200/mês na fase inicial, crescendo com uso |
| **Investimento único (pentest + setup)** | ~R$ 15.000–35.000 |
| **Time mínimo viável** | 1-3 devs atuais + 1 DevOps/SRE part-time/contrato + 1 consultoria de segurança pontual |
| **Prazo até primeiro cliente real em produção** | 4-6 semanas (infra + API + dashboard cliente) |
| **Prazo até app mobile MVP** | +6-10 semanas em paralelo |
| **Maior risco não-técnico** | Status da conta Ether (`AUTH_KEY_001`, ver PENDING.md) — bloqueia validação real antes mesmo de discutir infra |
| **Maior risco técnico atual** | Rate limiting e sessão do webhook em memória — não sobrevive a múltiplas instâncias (ver seção 4) |

---

## 1. O que "banking não pode travar" exige, na prática

"Não travar" não é uma característica que se compra — é uma meta de SLA que decide toda a arquitetura abaixo. Recomendo começar em **99,9% de disponibilidade** (~43 min de indisponibilidade tolerável por mês), não 99,99% (~4 min/mês): o segundo exige multi-região com failover automático, o que para uma equipe de 1-3 pessoas é operacionalmente inviável de manter bem. 99,9% é atingível com boa engenharia numa única região da DO, e escala para 99,95%+ depois que o time crescer.

Isso implica, no mínimo:
- **Nunca uma única instância** de API rodando sozinha (hoje é isso que o `docker-compose.yml` local faz — correto para dev, errado para produção).
- **Banco com standby síncrono** e failover automático (não é opcional para fintech).
- **Health checks reais** (não só "o processo está de pé", mas "o processo consegue falar com o banco e com a Ether").
- **Deploy sem downtime** (rolling deploy, não `docker compose down && up`).
- **Runbook de incidente escrito antes** de precisar dele, não durante.

## 2. Arquitetura recomendada na DigitalOcean

```
                         Cloudflare (WAF + DDoS + CDN)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
         DO Load Balancer (HTTPS)          DO Spaces + CDN
                    │                       (dashboards estáticos,
        ┌───────────┼───────────┐            comprovantes, docs KYC)
        │           │           │
   API #1       API #2       API #3      ← DO App Platform (autoscaling)
   (Node)       (Node)       (Node)         ou Droplets 2-4 vCPU / 4-8GB
        │           │           │
        └─────┬─────┴─────┬─────┘
              │           │
     DO Managed Postgres   DO Managed Redis
     (Primary + Standby)   (rate limit, cache,
     + PgBouncer            idempotência de webhook)
     + backup diário
     + point-in-time recovery
```

### Por que cada peça

| Componente | Escolha | Por quê |
|---|---|---|
| **Compute da API** | DO App Platform (Professional) | Autoscale nativo, deploy sem downtime, menos ops para equipe pequena. Alternativa: Droplets + LB se precisar de mais controle (ex: acesso a filesystem, WebSocket persistente) |
| **Banco** | DO Managed Postgres, plano com HA (standby) | Failover automático, backups automáticos, PITR. Nossa arquitetura (roles `authenticated`/`service_role`, RLS) funciona sem alteração — já testamos em Postgres puro |
| **Pooling de conexão** | PgBouncer em modo *transaction* | Cada request já abre `BEGIN...SET LOCAL ROLE...COMMIT` — é exatamente o padrão que pooling em modo transação atende bem. **Sem isso, múltiplas instâncias de API esgotam o limite de conexões do Postgres rapidinho** |
| **Redis** | DO Managed Redis | Rate limiting compartilhado entre instâncias (hoje é em memória — quebra com >1 instância, ver seção 4), cache de cotações, dedupe de webhook |
| **Load Balancer** | DO Load Balancer | TLS termination, health check por instância, sticky session desligado (JWT é stateless, não precisa) |
| **CDN/WAF** | Cloudflare (Pro, ~US$25/mês/domínio) | A DO não tem WAF/anti-DDoS de borda robusto — para fintech isso não é opcional. Cloudflare também dá certificado TLS gerenciado |
| **Object storage** | DO Spaces | Documentos de KYC, comprovantes, exports de relatório — nunca no filesystem do container |
| **Secrets** | Infisical (self-hosted ou cloud) ou Doppler | DO não tem secrets manager nativo forte. Não deixar segredo em variável de ambiente do App Platform sem rotação — hoje o `.env` local é aceitável para dev, não para produção |
| **Observabilidade** | Grafana + Loki + Prometheus (**já rodando** para o projeto antigo — reaproveitar) + Sentry para erro de aplicação | Você já paga por essa stack; não duplicar |
| **Uptime externo** | BetterStack ou UptimeRobot (fora da DO) | Se a DO cair inteira, monitoramento *dentro* da DO não avisa ninguém |
| **CI/CD** | GitHub Actions → deploy automático no App Platform | Elimina deploy manual, que é o jeito mais comum de causar indisponibilidade |
| **Infra como código** | Terraform para os recursos gerenciados (DB, Redis, LB, Spaces) | Hoje é tudo `docker-compose.yml` manual — não reproduzível, não versionado como infra |

## 3. Custos estimados (DigitalOcean + terceiros)

Faixas para a fase "crescimento inicial" (milhares de clientes, centenas-milhares de tx/dia). Convertido de USD a ~R$ 5,50.

| Item | USD/mês | R$/mês |
|---|---|---|
| API — 2-3 instâncias App Platform (Professional) | $50–150 | R$ 275–825 |
| Postgres gerenciado com HA (standby) | $60–240 | R$ 330–1.320 |
| Redis gerenciado | $15–60 | R$ 82–330 |
| Load Balancer | $12 | R$ 66 |
| Spaces + CDN | $5–20 | R$ 27–110 |
| Backups extra (snapshots) | $5–10 | R$ 27–55 |
| Cloudflare Pro | $25 | R$ 137 |
| Uptime monitoring externo | $0–29 | R$ 0–160 |
| Secrets manager (Infisical cloud, tier baixo) | $0–20 | R$ 0–110 |
| **Total infraestrutura recorrente** | **$172–566** | **≈ R$ 950–3.100** |

### 3.1 Dimensionamento técnico (CPU / memória / disco) — base 2000 clientes

A tabela acima só nomeia o serviço e uma faixa de preço; abaixo está o tamanho real por trás de
cada faixa, calculado para **2000 clientes cadastrados, ~700 ativos/dia** (ver premissas ao
final desta seção) e a versão equivalente para teste/homologação.

| Recurso | Produção (recomendado) | Teste/Homologação (recomendado) |
|---|---|---|
| **API — instância (DO App Platform)** | `professional-xs` (1 vCPU / 1 GB) por réplica; subir para `professional-s` (1 vCPU / 2 GB) se CPU sustentado > 65% | `professional-xs` (1 vCPU / 1 GB) |
| **API — réplicas** | min 2 / max 4 | min 0–1 (só em sprint ativo) / max 1 |
| **API — pool de conexão Postgres (`PGPOOL_MAX`)** | 12 por réplica (4×12 = 48 conexões via PgBouncer) | 5 |
| **Postgres — plano DO Managed** | `db-s-2vcpu-4gb` (2 vCPU / 4 GB RAM), **com standby (HA)** | `db-s-1vcpu-1gb` (1 vCPU / 1 GB), sem HA |
| **Postgres — disco (incluído no plano)** | 60 GB SSD (~10–15 GB/ano de crescimento no ledger → folga até ~2029) | 10–15 GB |
| **Postgres — conexões máx do plano** | ~97 diretas (reservar ~25 para migrations/monitoramento); via PgBouncer o app não esbarra nisso | ~25 |
| **PgBouncer** (obrigatório a partir de 2ª réplica de API) | 1 vCPU / 512 MB, modo `transaction` | dispensável com 1 réplica |
| **Redis — plano DO Managed** | `db-s-1vcpu-1gb` (1 vCPU / 1 GB) — rate limit compartilhado + dedupe webhook + cache token Ether | `db-s-1vcpu-1gb` compartilhado ou instância local, TTL curto |
| **Load Balancer** | gerenciado pela DO, sem dimensionamento manual de CPU | dispensável (acesso direto à instância) |
| **Spaces (object storage)** | 50–100 GB inicial (docs KYC, comprovantes, exports) | 5–10 GB |

**Premissas do cálculo:** ~35% dos 2000 clientes ativos por dia útil (≈700), ~25 chamadas/sessão,
2 sessões/dia → ~35 mil req/dia, pico de ~12–15 req/s em horário comercial; ~1,5 transação
financeira/cliente ativo/dia (~1.000 operações/dia, pico < 1 req/s — o gargalo é leitura de
extrato/relatório, não escrita); ~3 mil eventos de webhook Ether/dia, tipicamente em rajada após
qualquer instabilidade do provedor, o que justifica isolar o Redis/PgBouncer da carga de leitura
normal. Cada request de negócio ocupa uma conexão do pool durante toda a transação
(`BEGIN`→`set_config`→`SET LOCAL ROLE`→query→`COMMIT`); com latência ao Postgres gerenciado em
~1–2 ms, uma conexão sustenta ~30 req/s, então 12 conexões/réplica cobrem o pico com folga de
~20x. Revisar esta tabela a cada dobra de escala (de "milhares" para "dezenas de milhares" de
clientes), como já indicado na seção 8.

Fora da infra recorrente:

| Item | Custo único/anual | Observação |
|---|---|---|
| **Pentest externo** (obrigatório antes de ir ao ar com dinheiro real) | R$ 8.000–20.000 | Pontual, repetir a cada 6-12 meses |
| **Consultoria LGPD/DPO** | R$ 3.000–8.000/mês (part-time) ou R$ 15.000+ setup único | Depende se contrata DPO como serviço ou interno |
| **Certificação ISO 27001** (se decidir buscar) | R$ 60.000–150.000 + 6-12 meses | Não é bloqueador para operar como correspondente da Ether; vale para venda B2B/investidores depois |
| **Domínio + certificados** | ~R$ 100/ano | TLS via Let's Encrypt/Cloudflare é grátis |

## 4. O que já existe no código e precisa mudar antes de multi-instância

Isso é urgente e específico do nosso código atual — não é genérico:

1. **`express-rate-limit` está em memória** (`server/src/index.js`, `server/src/routes/auth.js`). Com 2+ instâncias atrás do Load Balancer, cada instância conta separadamente — um atacante distribui as tentativas entre instâncias e o limite deixa de valer. **Precisa de store Redis** (`rate-limit-redis`) antes de escalar horizontalmente.
2. **Pool de conexão por instância** (`server/src/db.js`, `max: 10`). Com N instâncias × 10 conexões, o Postgres gerenciado tem limite de conexões por plano — **PgBouncer é obrigatório**, não opcional, a partir da 2ª instância.
3. **Cache de token da Ether é em memória por processo** (`server/src/ether.js`, variável `cachedToken`). Com múltiplas instâncias, cada uma autentica separadamente na Ether — funciona, mas gera autenticações redundantes. Não é bug, mas vale mover para Redis para reduzir chamadas.
4. **Sem circuit breaker para a Ether.** Se a Ether ficar lenta/instável, hoje cada request espera o timeout inteiro (o `fetch` não tem timeout configurado em `ether.js`) — isso pode encadear esgotamento de conexões na API sob instabilidade do provedor. Adicionar timeout explícito + circuit breaker antes de escalar.

## 5. Segurança e certificação — o que realmente se aplica

Como correspondente da Ether (não instituição regulada própria), a responsabilidade regulatória principal (autorização BACEN, PCI-DSS da rede de cartões, etc.) é da Ether. Isso **não** elimina a responsabilidade do LIVREPAY:

| Certificação/obrigação | Aplica ao LIVREPAY? | Ação |
|---|---|---|
| **LGPD** | Sim, sempre — vocês são controladores dos dados dos seus próprios clientes | Mapeamento de dados, política de privacidade, DPO (interno ou terceirizado), runbook de notificação à ANPD em 72h (já esboçado no SECURITY.md) |
| **Autorização BACEN (IP/SCD)** | Não, enquanto operar sob a Ether | Confirmar por contrato que a Ether cobre a parte regulada; guardar essa documentação para due diligence de investidor/parceiro |
| **PCI-DSS** | Só se algum dia tocar PAN/CVV de cartão diretamente | Hoje o schema já evita isso (`cards.last4` + token do emissor) — manter essa regra |
| **Pentest antes de produção** | Sim, recomendação forte, não é "nice to have" | Contratar antes do primeiro cliente real com dinheiro |
| **ISO 27001 / SOC 2** | Não bloqueante agora | Vale para captar investimento ou vender B2B enterprise depois — orçar, não priorizar no MVP |
| **Certificado TLS** | Sim, trivial | Let's Encrypt via Cloudflare/DO, renovação automática |

**Peça à Ether, por escrito**: as certificações que ela detém (PCI-DSS, ISO 27001, SOC 2, autorização BACEN) — isso entra na sua própria documentação de segurança para mostrar a clientes/investidores que a cadeia é coberta ponta a ponta, mesmo sem o LIVREPAY tê-las diretamente.

## 6. Time mínimo para sustentar isso

Com 1-3 devs hoje, a lacuna real não é "mais devs de produto" — é **operação**:

| Papel | Regime sugerido | Por quê |
|---|---|---|
| DevOps/SRE | Contrato part-time ou freelancer sênior | Ninguém do time atual deveria estar de guarda 24/7 sozinho para uma fintech. Mesmo part-time, alguém precisa desenhar o runbook de incidente e revisar a config de HA |
| Consultoria de segurança/LGPD | Pontual (setup) + revisão trimestral | Pentest inicial + DPO como serviço é mais barato que contratar CISO nesse estágio |
| Backend/infra (dentro do time atual) | — | Já cobre API/banco. Escopo de mobile + IA + 2 dashboards é grande para 1-3 pessoas — considerar priorizar sequencialmente (ver seção 7), não em paralelo |

## 7. Sequenciamento recomendado (não simultâneo)

Tentar subir API + dois dashboards + app mobile + IA ao mesmo tempo com 1-3 pessoas é o jeito mais comum de nenhum deles ficar bom. Ordem sugerida:

1. **Resolver bloqueio da conta Ether** (`AUTH_KEY_001` — já documentado em PENDING.md). Sem isso, nada abaixo tem como ser validado com dinheiro de verdade.
2. **Infra de produção mínima viável** (2-3 semanas): Postgres gerenciado + PgBouncer, Redis, App Platform com 2 instâncias, Load Balancer, Cloudflare, secrets manager, CI/CD. Corrigir os 4 pontos da seção 4 antes de multi-instância.
3. **Subir API + dashboard cliente atual em produção** (o que já está construído e testado — 37 testes e2e, 29 de banco).
4. **Pentest + hardening de segurança** (paralelo ao passo 3, 2-4 semanas).
5. **Dashboard mestre** — preciso confirmar o escopo: presumo que seja um painel interno para a equipe LIVREPAY (aprovação de KYC, gestão de contas de clientes B2B, visão consolidada de risco/fraude), distinto do dashboard que já existe (que atende o cliente final do LIVREPAY). Se for isso, é um app novo reaproveitando a mesma API — 3-5 semanas.
6. **App mobile do zero** (React Native, dado que o dashboard já é React) — 6-10 semanas para um MVP com os fluxos essenciais (login, saldo, PIX, extrato).
7. **IA** — sem escopo definido ainda, não é possível estimar prazo. Recomendo definir o caso de uso primeiro (antifraude na transação? assistente de suporte? score de crédito?) antes de reservar infra ou tempo de time para isso.

## 8. O que este documento não resolve

- Não substitui uma auditoria jurídica sobre o contrato com a Ether (o que exatamente ela garante como correspondente).
- Não inclui o custo do pentest/DPO como consultoria contínua além do setup inicial.
- Não assume nenhum número real de clientes — os custos escalam proporcionalmente; revisar esta estimativa a cada dobra de escala (de "milhares" para "dezenas de milhares", por exemplo).
