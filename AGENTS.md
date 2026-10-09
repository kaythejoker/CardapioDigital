# Cardápio Digital — contexto para agentes

SaaS white label de cardápio digital com pedido por mesa: o cliente escaneia o QR da mesa, digita um PIN de 4 dígitos que o garçom passa e envia o pedido, que cai numa fila priorizada na tela da cozinha. Vendido por um revendedor (Felipe) para restaurantes, cada um isolado dos outros.

## Fonte da verdade

- **[docs/spec.md](docs/spec.md)** — spec completa do MVP (papéis, fluxos, regras de negócio, 20 telas, arquitetura, tabelas, fases, critérios de aceite, perguntas em aberto).
- A seção **"Prompt 1 — Aplicação"** da spec é a instrução de construção: stack, modelo de dados, regras que não podem falhar, prioridade da fila, rotas, tokens visuais e a ordem das 8 etapas. Siga-a.
- A seção **"Prompt 2 — Visual (ChatGPT)"** gera as imagens de referência das telas. Elas ainda não foram geradas nem anexadas ao repo.
- Original no claude.ai: https://claude.ai/artifact/KM3dTUAMjh1ZdTj1z6jZX7 (exportado em 2026-10-09, rev 13).

## Como trabalhar

- Construir em **8 etapas**. Ao fim de cada uma: rodar o projeto, conferir que funciona, mostrar um resumo curto do que foi feito e de como testar, e **esperar o ok do usuário** antes da próxima.
- Não implementar nada fora do escopo do MVP sem perguntar. Se algo estiver ambíguo, perguntar antes de decidir.
- Toda a interface e a comunicação com o usuário são em **português do Brasil**.
- Valores em centavos (inteiros), moeda BRL, fuso `America/Sao_Paulo`.

## Estado atual (2026-10-09)

- Repo git iniciado: branch `main`, remote `origin` = https://github.com/kaythejoker/CardapioDigital.git. O remote está vazio.
- Só existem este arquivo, `CLAUDE.md` e `docs/spec.md`. **Nenhuma etapa foi iniciada.** O próximo passo é a etapa 1 (Setup).

## Decisões pendentes (resolver com o usuário antes da etapa 1)

1. **Onde fica o Supabase.** A máquina não tem Docker, então o Supabase local não roda: o banco precisa ser um projeto na nuvem. Opções:
   - criar um projeto novo (sugestão: nome "Cardapio Digital", região `sa-east-1`). Na org "Projetos Teste IASL" o custo é US$ 10/mês. O usuário está conectando **outra org** do Supabase, então confirme em qual org criar;
   - o usuário cria o projeto e passa o project ref;
   - só código por enquanto: scaffold e migrations/RLS/seed em arquivos, sem aplicar.
2. **Perguntas em aberto da spec** (marca do Felipe, bar separado da cozinha, taxa de 10%, mais de uma comanda por mesa, acesso do garçom, quem monta o cardápio, domínio). A recomendação é seguir o modelo de dados do Prompt 1 como está e ajustar depois com migrations novas, mas o usuário ainda não confirmou.

Não use o projeto Supabase **GrowthTracker** para nada deste repo: ele pertence a outro produto.

## Ambiente de desenvolvimento

- Windows 11; Node 24.15, npm 11.12.
- Sem Docker; a Supabase CLI não está instalada (usar `npx supabase ...`).
- `gh` autenticado como `kaythejoker`.
- Commit ou push só quando o usuário pedir.
