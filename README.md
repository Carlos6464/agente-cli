# 🤖 Agent CLI

Agente CLI inteligente e adaptável a qualquer stack de projeto. Desenvolvido para automatizar tarefas repetitivas como geração de código, scaffolding de módulos, execução de tarefas e muito mais — tudo respeitando os padrões do seu projeto e rodando 100% local sem enviar dados para serviços externos.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Comandos disponíveis](#comandos-disponíveis)
- [Como rodar](#como-rodar)
- [Etapas de construção](#etapas-de-construção)
- [Etapa 1 — CLI Layer (concluída ✅)](#etapa-1--cli-layer-concluída-)
- [Roadmap](#roadmap)

---

## Visão Geral

O Agent CLI foi projetado para resolver um problema real: automatizar tarefas repetitivas de desenvolvimento respeitando os padrões do projeto atual — seja em casa com uma stack ou no trabalho com outra completamente diferente.

Ele funciona em três modos principais:

- **Projeto novo** — wizard interativo que detecta e configura a stack do zero
- **Projeto existente** — analisa o que já foi feito e continua de onde parou
- **Geração contínua** — gera código, roda tarefas e conversa no contexto do projeto

Toda a inteligência roda localmente via **Ollama**, garantindo que nenhum dado sensível saia da sua máquina.

---

## Comandos disponíveis

| Comando                        | Descrição                                          | Status      |
| ------------------------------ | -------------------------------------------------- | ----------- |
| `agent new <nome>`             | Cria um projeto do zero com wizard de stack        | 🔄 Etapa 12 |
| `agent init`                   | Aprende a stack de um projeto existente            | 🔄 Etapa 8  |
| `agent generate <tipo> <nome>` | Gera código seguindo os padrões do projeto         | 🔄 Etapa 9  |
| `agent run`                    | Executa tarefas com seleção interativa             | 🔄 Etapa 10 |
| `agent chat`                   | Conversa livre com o agente no contexto do projeto | 🔄 Etapa 11 |

---

## Como rodar

### Pré-requisitos

- Node.js v20 ou superior
- npm

### Instalação

```bash
# Clone ou baixe o projeto
cd agente-cli

# Instale as dependências
npm install
```

### Desenvolvimento

```bash
# Rodar qualquer comando em modo desenvolvimento
npm run dev -- --help
npm run dev -- generate module payments
npm run dev -- generate page dashboard --app web
npm run dev -- init
npm run dev -- run
npm run dev -- chat
npm run dev -- new meu-projeto
npm run dev -- new meu-projeto --profile trabalho
```

> O `--` após `npm run dev` separa os argumentos do npm dos argumentos do seu programa. Quando o agente for instalado globalmente com `npm install -g`, você digitará `agent generate module payments` diretamente.

### Build para produção

```bash
npm run build        # compila TypeScript → JavaScript em /dist
npm start -- --help  # roda o JavaScript compilado
```

---

## Etapas de construção

O agente foi planejado em 14 etapas. Cada etapa constrói sobre a anterior.

```
Etapa 1  ✅  CLI Layer + estrutura base do package
Etapa 2  ✅  Filesystem Tools (read, write, list, search)
Etapa 3  ✅  Detector de Stack e padrões (inclui ORM)
Etapa 4  ✅  LLM Provider abstrato com Ollama
Etapa 5  ✅  RAG: embeddings + vector store + retriever
Etapa 6  ✅  Context Builder usando RAG
Etapa 7  ✅  Agent Core com tool calling loop
Etapa 8  ✅  agent init (projeto novo e existente)
Etapa 9  ✅  agent generate
Etapa 10 ✅  agent run com seleção e análise de erro
Etapa 11 ✅  agent chat com loop de conversa
Etapa 12 ✅  Wizard completo com resolver de dependências
Etapa 13 ✅  Template Engine e agent new
Etapa 14 ✅  Memória de perfis, histórico e reindexação
```

---

## Etapa 1 — CLI Layer (concluída ✅)

### O que foi construído

A Etapa 1 criou a **fundação do agente**. Nada de inteligência artificial ainda, nada de leitura de arquivos, nada de geração de código. O objetivo foi exclusivamente um: fazer o terminal reconhecer o comando `agent` e saber o que fazer com cada subcomando.

### Estrutura de pastas criada

```
agente-cli/
  src/
    index.ts          ← entry point, registra todos os comandos
    commands/
      new.ts          ← cria projeto do zero
      init.ts         ← aprende projeto existente
      generate.ts     ← gera código
      run.ts          ← executa tarefas
      chat.ts         ← conversa com o agente
    core/             ← lógica central (próximas etapas)
    rag/              ← sistema RAG (próximas etapas)
    providers/        ← conexão com LLM (próximas etapas)
    tools/            ← ferramentas do agente (próximas etapas)
    templates/        ← templates de stack (próximas etapas)
    memory/           ← memória e perfis (próximas etapas)
```

**Por que essa estrutura:**

Cada pasta tem uma responsabilidade única e isolada. `commands/` vai crescer bastante — cada comando terá lógica de RAG, LLM e contexto. Manter um arquivo por comando evita arquivos impossíveis de manter. As outras pastas já existem vazias para que cada etapa saiba exatamente onde colocar seu código.

### Arquivos explicados

**`package.json`**

O arquivo de identidade do projeto. O campo mais importante é o `bin`:

```json
"bin": {
  "agent": "./dist/index.js"
}
```

Esse campo transforma o projeto em um comando de terminal. Quando instalado globalmente com `npm install -g`, o npm cria um atalho chamado `agent` no sistema operacional.

As dependências escolhidas:

- `commander` — interpreta o que é digitado no terminal, cuida de parsing, argumentos, opções e geração automática do help
- `chalk` — colore o output no terminal, essencial para boa experiência de uso
- `inquirer` — vai fazer perguntas interativas no terminal (wizard do `agent new`)
- `ora` — spinners animados enquanto o agente processa algo

**`tsconfig.json`**

Configura o compilador TypeScript. As escolhas mais importantes:

- `"module": "CommonJS"` — sistema de módulos mais estável para CLIs no Node.js
- `"moduleResolution": "node"` — resolução de módulos no padrão Node.js
- `"strict": false` — desabilitado temporariamente para facilitar o desenvolvimento. Será reativado quando o agente estiver completo
- `"outDir": "./dist"` — JavaScript compilado vai para a pasta `dist/`

**`src/index.ts`**

Porta de entrada de tudo. Quando você digita `agent`, esse é o primeiro arquivo que roda.

A linha `#!/usr/bin/env node` no topo é o shebang — instrui o sistema operacional a usar o Node.js para executar o arquivo quando instalado como executável global.

O `process.argv` contém tudo que foi digitado no terminal. O Commander pega esse array, identifica o comando e os argumentos, e chama a função correta automaticamente.

**`src/commands/*.ts`**

Cada arquivo exporta uma função que retorna um objeto `Command`. Argumentos com `<>` são obrigatórios — o Commander valida automaticamente e imprime erro se algum estiver faltando. Opções com `--` são opcionais e podem vir em qualquer posição.

### Problema encontrado e solução

Foram necessárias três tentativas de configuração por um conflito entre sistemas de módulos do Node.js.

O Node.js tem dois sistemas coexistindo: o antigo CommonJS com `require()` e o moderno ESM com `import/export`. O TypeScript, ts-node e Node v20 têm comportamentos diferentes e às vezes conflitantes sobre qual usar.

A solução final foi usar `node -r ts-node/register` no script de desenvolvimento. Em vez de chamar o binário do ts-node que tenta detectar o ambiente automaticamente, o `-r` instrui o Node diretamente a carregar o ts-node como plugin antes de qualquer coisa — sem ambiguidade, sem detecção automática.

```json
"dev": "node -r ts-node/register src/index.ts"
```

### Resultado da Etapa 1

```
✅ CLI reconhece agent e todos os 5 subcomandos
✅ Argumentos e opções funcionando com validação automática
✅ Help gerado automaticamente para cada comando
✅ Feedback visual com cores no terminal
✅ Estrutura de pastas pronta para todas as etapas
✅ TypeScript configurado e compilando corretamente
```

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

1\*

---

## Etapa 2 — Filesystem Tools (concluída ✅)

### O que foi construído

A Etapa 2 criou as **ferramentas de acesso ao sistema de arquivos**. São funções que o agente usa para interagir com o projeto — ler, escrever, listar e buscar. Toda etapa seguinte depende delas.

Foram criados dois arquivos:

- `src/tools/filesystem.tools.ts` — as 4 ferramentas + mapa de extensões por linguagem
- `src/test-filesystem.ts` — testes manuais para validar cada uma

### As 4 ferramentas

**`readFile(filePath)`**

Lê o conteúdo de um arquivo e retorna como string. Antes de ler verifica se o arquivo existe e se não é uma pasta. Converte o caminho para absoluto com `path.resolve` para funcionar independente de onde o agente é executado.

**`writeFile(filePath, content)`**

Cria ou sobrescreve um arquivo. O diferencial é que cria automaticamente todas as pastas intermediárias do caminho caso não existam — então `writeFile('./src/modules/payments/payments.module.ts', ...)` cria as pastas `modules` e `payments` se necessário antes de escrever o arquivo.

**`listDir(dirPath, recursive?)`**

Lista o conteúdo de uma pasta retornando nome, tipo (file/directory), caminho completo e extensão. Com `recursive = true` desce em todas as subpastas. Ignora automaticamente `node_modules`, `.git`, `dist`, `.next` e outras pastas geradas — elas não contêm código do projeto e sobrecarregariam o contexto do LLM.

**`searchCode(dirPath, term, extensions?, maxResults?)`**

Busca um termo dentro de todos os arquivos do projeto retornando cada ocorrência com arquivo, número da linha e conteúdo da linha. A busca é case-insensitive. O limite padrão de 50 resultados protege o contexto do LLM de ser sobrecarregado.

### LANGUAGE_EXTENSIONS — extensões por linguagem

Durante a construção foi identificado que fixar as extensões de busca em `['ts', 'tsx', 'js', 'jsx', 'json', 'md']` limitaria o agente a projetos JavaScript/TypeScript. Como o objetivo é suportar qualquer stack — incluindo projetos Python, Laravel, Rails e outros que possam existir no futuro — foi criado o `LANGUAGE_EXTENSIONS`, um mapa exportado com presets de extensões por linguagem:

```typescript
LANGUAGE_EXTENSIONS.node; // ts, tsx, js, jsx, mjs, cjs
LANGUAGE_EXTENSIONS.python; // py, pyw, pyi
LANGUAGE_EXTENSIONS.php; // php, blade.php
LANGUAGE_EXTENSIONS.ruby; // rb, rake, gemspec
LANGUAGE_EXTENSIONS.go; // go
LANGUAGE_EXTENSIONS.rust; // rs
LANGUAGE_EXTENSIONS.java; // java, kt, kts
LANGUAGE_EXTENSIONS.csharp; // cs, csx
LANGUAGE_EXTENSIONS.config; // json, yaml, yml, toml, env, ini, conf
LANGUAGE_EXTENSIONS.docs; // md, mdx, txt, rst
LANGUAGE_EXTENSIONS.styles; // css, scss, sass, less, styl
LANGUAGE_EXTENSIONS.templates; // html, htm, ejs, hbs, pug, twig, vue, svelte
LANGUAGE_EXTENSIONS.database; // sql, prisma, graphql, gql
LANGUAGE_EXTENSIONS.shell; // sh, bash, zsh, fish, ps1
```

O uso fica semântico e combinável via spread do JavaScript:

```typescript
// preset direto
searchCode(".", "def ", LANGUAGE_EXTENSIONS.python);

// combinando linguagens
searchCode(".", "DATABASE_URL", [
  ...LANGUAGE_EXTENSIONS.python,
  ...LANGUAGE_EXTENSIONS.config,
]);

// extensões customizadas — a assinatura não mudou
searchCode("./src", "export", ["ts"]);
```

O padrão quando nenhuma extensão é informada combina `node + config + docs`, cobrindo a maioria dos projetos sem ser excessivo. O Detector de Stack (Etapa 3) vai usar esse mapa para saber em quais arquivos buscar dependendo da stack detectada no projeto.

### Padrão de retorno adotado

Todas as ferramentas retornam um objeto `{ success, content/items/matches, error }` em vez de lançar exceções. Isso é uma decisão arquitetural importante — o agente roda as ferramentas dentro de um loop controlado pelo LLM, e se uma ferramenta lançar uma exceção não tratada, o agente inteiro para. Com o padrão `success/error` o agente verifica o resultado, trata o erro e continua funcionando normalmente.

### Por que `require` para módulos nativos do Node

O TypeScript com `"module": "CommonJS"` tem conflito ao misturar `import` de módulos nativos do Node (`fs`, `path`) com `export` das próprias funções no mesmo arquivo. A solução estável foi usar `require` para os módulos nativos e `export` para expor as funções — combinação que o ts-node interpreta sem ambiguidade.

### Resultado dos testes

```
✅ readFile lê arquivo existente corretamente
✅ readFile retorna erro descritivo para arquivo inexistente
✅ writeFile cria arquivo e todas as pastas intermediárias
✅ readFile lê o arquivo recém criado
✅ listDir lista pasta sem recursão (9 itens)
✅ listDir lista pasta com recursão (15 itens)
✅ searchCode encontra ocorrências com extensões padrão
✅ searchCode funciona com preset LANGUAGE_EXTENSIONS.node
✅ searchCode combina múltiplos presets com spread
✅ searchCode aceita extensões customizadas
✅ searchCode retorna 0 resultados para termo inexistente
✅ Todos os presets de LANGUAGE_EXTENSIONS listados corretamente
✅ Pasta de teste removida após execução
```

---

_README atualizado após melhoria do searchCode com LANGUAGE_EXTENSIONS_

---

## Etapa 3 — Detector de Stack (concluída ✅)

### O que foi construído

A Etapa 3 criou o **Detector de Stack** — o componente que entra em qualquer projeto e responde: "o que está sendo usado aqui?". Ele usa as Filesystem Tools da Etapa 2 para ler o `package.json` e a estrutura de pastas, montando um perfil completo e tipado da stack.

Foram criados dois arquivos:

- `src/core/detector/stack-detector.ts` — a lógica de detecção completa
- `src/test-detector.ts` — testes manuais para validar a detecção

### O que ele detecta

O detector monta um `StackProfile` completo com os seguintes campos:

| Campo            | O que detecta                                                         | Como detecta                                                    |
| ---------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `language`       | typescript, javascript, python, php, ruby, go                         | tsconfig.json, requirements.txt, composer.json, Gemfile, go.mod |
| `packageManager` | npm, yarn, pnpm                                                       | lock files (pnpm-lock.yaml, yarn.lock, package-lock.json)       |
| `monorepo`       | turborepo, nx, lerna, none                                            | turbo.json, nx.json, lerna.json, deps                           |
| `backend`        | nestjs, express, fastify, laravel, django, fastapi, rails             | deps do package.json, composer.json, requirements.txt, Gemfile  |
| `frontend`       | nextjs, react, nuxt, angular, vue, vite                               | deps do package.json                                            |
| `mobile`         | expo, react-native-cli                                                | deps do package.json                                            |
| `orm`            | prisma, typeorm, drizzle, mongoose, sequelize, eloquent, activerecord | deps do package.json, linguagem detectada                       |
| `database`       | postgresql, mysql, sqlite, mongodb, redis                             | driver instalado, schema do Prisma                              |
| `architecture`   | ddd, mvc, modular, simple                                             | nomes de pastas com sistema de score                            |
| `testing`        | jest, vitest, phpunit, pytest, rspec                                  | deps do package.json, linguagem detectada                       |
| `apps`           | lista de apps no monorepo                                             | pasta /apps                                                     |
| `examplePaths`   | arquivos reais para usar como few-shot                                | busca por .module.ts, .service.ts, .controller.ts, .entity.ts   |

### Decisões arquiteturais importantes

**Por que `package.json` é a fonte principal**

O `package.json` lista todas as dependências do projeto de forma estruturada e confiável. Se o projeto usa NestJS, tem `@nestjs/core` ali. O detector lê o arquivo uma única vez no início e usa o resultado em todas as detecções — sem abrir o mesmo arquivo várias vezes.

**Por que `allDeps` combina `dependencies` e `devDependencies`**

Algumas ferramentas ficam em `dependencies` e outras em `devDependencies` dependendo de como o projeto foi configurado. O TypeScript por exemplo pode estar em qualquer uma das duas. Juntar os dois arrays evita falsos negativos.

**Por que a ordem importa no `detectFrontend`**

Next.js usa React internamente, então qualquer projeto Next.js também tem `react` nas dependências. Verificar `next` antes de `react` garante que projetos Next.js sejam identificados corretamente e não como React puro.

**Sistema de score no `detectArchitecture`**

Nenhuma pasta isolada determina com certeza o padrão arquitetural. O detector exige pelo menos 2 indicadores para afirmar DDD (`domain`, `application`, `infra`, `use-cases`...) ou MVC (`controllers`, `models`, `views`, `routes`). Isso elimina falsos positivos.

**O campo `ambiguities`**

Quando o detector não consegue determinar algo sozinho — como o banco de dados quando não há driver instalado, ou a arquitetura quando as pastas não seguem nenhuma convenção conhecida — ele registra o campo em `ambiguities`. O `agent init` vai usar essa lista para saber exatamente quais perguntas fazer ao usuário. Uma pergunta por vez, apenas quando necessário.

**O campo `examplePaths`**

O LLM vai receber arquivos reais do projeto como exemplos para imitar o padrão existente. O detector busca automaticamente por `.module.ts`, `.service.ts`, `.controller.ts` e `.entity.ts` e registra os caminhos encontrados. Se o projeto não tem código ainda, o campo fica vazio e o LLM usa só o contexto da stack detectada.

### Resultado dos testes

Testado contra o próprio projeto `agente-cli`:

```
✅ Projeto:        agent-cli
✅ Linguagem:      typescript   (detectou via tsconfig.json)
✅ Package Manager:npm          (detectou via package-lock.json)
✅ Monorepo:       none         (sem turbo.json, nx.json ou lerna.json)
✅ Backend:        none         (sem @nestjs/core, express ou fastify)
✅ Frontend:       none         (sem next, react, vue ou angular)
✅ Mobile:         none         (sem expo ou react-native)
✅ ORM:            none         (sem prisma, typeorm ou drizzle)
✅ Banco:          unknown      (correto — sem driver instalado)
✅ Arquitetura:    unknown      (correto — projeto CLI sem pastas de domínio)
✅ Todos os 12 campos obrigatórios presentes
✅ Ambiguidades registradas corretamente para o agent init tratar
```

Os campos `unknown` em `database` e `architecture` são o comportamento correto — o agente-cli não é uma aplicação com banco de dados nem segue padrão DDD ou MVC, então o detector foi honesto ao registrar as ambiguidades em vez de adivinhar.

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

3\*

---

## Etapa 4 — LLM Provider (concluída ✅)

### O que foi construído

A Etapa 4 criou a **camada de comunicação com o modelo de linguagem**. É aqui que o agente ganhou inteligência de verdade — a capacidade de enviar perguntas e receber respostas do Ollama rodando 100% local.

Foram criados três arquivos:

- `src/providers/llm-provider.interface.ts` — o contrato abstrato que todo provider deve seguir
- `src/providers/ollama.provider.ts` — a implementação concreta para o Ollama
- `src/test-provider.ts` — testes manuais para validar a integração

### A interface `ILLMProvider`

É o contrato central da etapa. O agente nunca importa `OllamaProvider` diretamente — ele sempre fala com `ILLMProvider`. Isso garante que trocar de modelo ou provedor no futuro não exige mudar nada no resto do agente.

```typescript
interface ILLMProvider {
  isAvailable(): Promise<boolean>;
  complete(messages, options?): Promise<LLMResult>;
  stream(messages, options?): AsyncGenerator<LLMStreamChunk>;
  listModels(): Promise<string[]>;
}
```

### Os dois modelos configurados

```typescript
OLLAMA_MODELS.DEFAULT = "deepseek-coder-v2:latest"; // 8.9GB — geração complexa
OLLAMA_MODELS.FAST = "deepseek-coder:1.3b"; // 776MB — tarefas rápidas
```

O agente usa o modelo certo para cada situação. Geração de módulos completos e raciocínio profundo usam o `deepseek-coder-v2`. Classificações rápidas e respostas simples usam o `1.3b` que responde muito mais rápido.

### Os dois modos de geração

**`complete`** — espera a resposta inteira antes de retornar. Ideal para `agent generate` onde você quer o arquivo completo de uma vez. Usa `temperature: 0.1` — próximo de zero deixa o modelo mais determinístico e preciso, essencial para código correto.

**`stream`** — retorna chunks enquanto o modelo gera, igual ao ChatGPT. Ideal para `agent chat` onde o usuário quer ver a resposta sendo digitada em tempo real. Usa `temperature: 0.7` — mais alto porque conversas se beneficiam de respostas mais naturais e variadas.

### O `AsyncGenerator` no streaming

```typescript
for await (const chunk of provider.stream(messages)) {
  process.stdout.write(chunk.content); // imprime conforme chega
  if (chunk.done) break;
}
```

O `AsyncGenerator` é uma funcionalidade do JavaScript que permite gerar valores ao longo do tempo de forma assíncrona. Cada vez que o Ollama manda um pedaço de texto pela rede, o generator faz `yield` desse pedaço imediatamente — sem acumular tudo na memória antes de mostrar ao usuário.

### Zero dados saem da máquina

Todo o processamento acontece localmente. O `fetch` aponta para `http://localhost:11434` — a rede local da máquina. Nenhuma requisição sai para a internet. Isso vale tanto para o ambiente de desenvolvimento quanto para o servidor, bastando trocar a `baseUrl` na configuração.

### Resultado dos testes

```
✅ Ollama detectado rodando em http://localhost:11434
✅ 2 modelos encontrados: deepseek-coder:1.3b e deepseek-coder-v2:latest
✅ Modelo principal (deepseek-coder-v2) respondeu corretamente em português
✅ Streaming funcionando — 90 chunks recebidos em tempo real
✅ Modelo leve (deepseek-coder:1.3b) respondeu corretamente
✅ Erro de conexão tratado e retornado corretamente
```

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

4\*

---

## Etapa 5 — RAG (concluída ✅)

### O que foi construído

A Etapa 5 criou o **sistema de busca por contexto** — o componente que transforma o agente de um gerador de código genérico em um gerador que conhece e respeita os padrões do seu projeto.

Foram criados cinco arquivos:

- `src/rag/embeddings.ts` — gera vetores numéricos a partir de texto via Ollama
- `src/rag/vector-store.ts` — armazena e busca vetores por similaridade em JSON local
- `src/rag/indexer.ts` — lê o projeto, divide em chunks e indexa no vector store
- `src/rag/retriever.ts` — busca os trechos mais relevantes dado uma query
- `src/test-rag.ts` — testes manuais para validar todo o pipeline

### Como o RAG funciona

```
Sem RAG:
"gera um módulo de payments"
→ modelo adivinha como você escreve código

Com RAG:
"gera um módulo de payments"
→ busca no índice: módulo de orders (similar)
→ manda para o modelo: instrução + exemplo real do projeto
→ modelo imita exatamente o seu padrão
```

### As 4 peças

**`embeddings.ts`** — usa o modelo `nomic-embed-text` (274MB) rodando no Ollama para transformar texto em vetores de 768 dimensões. Textos com significados parecidos ficam próximos no espaço vetorial. Processa em lote com callback de progresso para mostrar ao usuário durante a indexação.

**`vector-store.ts`** — armazena os vetores em `.agent/index/vectors.json` na raiz do projeto. Usa similaridade de cosseno para encontrar os vetores mais próximos de uma query. Implementado em JSON puro sem dependências nativas — funciona em qualquer máquina sem problemas de instalação.

**`indexer.ts`** — lê todos os arquivos do projeto, divide em chunks de 50 linhas com sobreposição de 10 linhas (para não perder contexto nas bordas), gera os embeddings e salva no vector store. Suporta reindexação incremental — pula arquivos já indexados para ser rápido no dia a dia.

**`retriever.ts`** — gera o embedding da query do usuário, busca os vetores mais próximos no índice e retorna os trechos de código correspondentes. A função `formatContextForPrompt` transforma os resultados em um bloco de texto estruturado pronto para inserir no system prompt do LLM.

### Por que JSON e não LanceDB ou ChromaDB

LanceDB e ChromaDB têm dependências nativas que causam problemas de instalação em diferentes sistemas. O JSON local é simples, sem dependências, funciona em qualquer máquina e é fácil de inspecionar. Para o volume de dados do agente (centenas de arquivos, não milhões), o desempenho é mais que suficiente.

### Nota sobre o modelo de embeddings em português

O `nomic-embed-text` foi treinado predominantemente em inglês. Queries em português ficam num espaço vetorial menos preciso. No uso real isso não é problema porque o código indexado é predominantemente em inglês — nomes de funções, classes, variáveis e imports. O Teste 4 confirmou: `PaymentsModule` encontrado com 88.8% de similaridade.

### Resultado dos testes

```
✅ nomic-embed-text disponível e gerando vetores de 768 dimensões
✅ Embeddings de textos similares ficam próximos no espaço vetorial
✅ Vector Store salvou e buscou entradas corretamente
✅ 22 arquivos indexados, 109 chunks, 2424kb de índice gerado
✅ Retriever encontrou arquivos relevantes por significado (não só palavras)
✅ Contexto formatado e pronto para inserir no prompt do LLM
```

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

5\*

---

## Etapa 6 — Context Builder (concluída ✅)

### O que foi construído

A Etapa 6 criou o **Context Builder** — o componente que une todas as peças construídas até agora em um único prompt rico e estruturado para o LLM. É o maestro que organiza stack detectada, contexto do RAG e instrução do usuário em mensagens que o modelo consegue usar para gerar código alinhado com o projeto.

Foram criados dois arquivos:

- `src/core/context-builder/context-builder.ts` — a lógica de montagem do contexto
- `src/test-context-builder.ts` — testes manuais que validam os três modos

### O fluxo completo

```
Stack detectada (Etapa 3)
      +
Contexto do RAG (Etapa 5)
      +
Instrução do usuário
      +
Regras de geração por stack
      =
System prompt completo para o LLM
```

### Os três modos de contexto

**`generate`** — o mais completo. Inclui stack completa, regras específicas por framework e ORM, regras de arquitetura e exemplos do RAG focados em código. O LLM recebe instruções precisas: se o projeto usa NestJS + DDD, ele sabe usar decorators, separar camadas e criar use-cases.

**`chat`** — mais leve. Inclui a stack mas sem regras rígidas de formato. O LLM responde livremente com base no contexto recuperado do projeto.

**`run`** — focado em comandos. Inclui o package manager e os apps do monorepo para o LLM montar o comando certo — `pnpm --filter @app/api test` em vez de um `npm test` genérico.

### Regras específicas por stack

O context builder não trata todas as stacks igual. Exemplos do que ele instrui:

- **NestJS** → usar decorators, injeção de dependência pelo construtor
- **DDD** → separar domain, application e infra, nunca importar infra a partir do domain
- **Prisma** → usar PrismaClient, definir novos models no schema.prisma
- **TypeORM** → usar decorators @Entity, @Column, injetar repositories pelo módulo
- **Laravel** → seguir convenções de controllers, models e migrations, usar Eloquent

### Por que o Teste 4 é o mais importante

É onde tudo converge de verdade: detecta stack → monta contexto → busca RAG → envia para o LLM → recebe resposta baseada no projeto real.

O resultado comprovou o funcionamento end-to-end — o LLM respondeu sobre as filesystem tools citando os dois arquivos corretos, as quatro funções corretas e o propósito de cada uma. Ele não adivinhou: leu do índice RAG do projeto com 6086 caracteres de contexto relevante.

### Resultado dos testes

```
✅ Stack detectada e incluída no system prompt
✅ Linguagem e package manager presentes no contexto
✅ Modo generate: 804 caracteres de system prompt com regras da stack
✅ Modo chat: 6086 caracteres com contexto do RAG incluído
✅ Modo run: package manager presente nas regras de execução
✅ LLM respondeu corretamente sobre o projeto usando o contexto montado
```

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

6\*

---

## Etapa 7 — Agent Core (concluída ✅)

### O que foi construído

A Etapa 7 criou o **loop principal do agente** — o componente que transforma o agente de um gerador de texto em um agente que age no projeto. O LLM agora pode decidir por conta própria quais ferramentas usar, em que ordem, e quando parar.

Foram criados quatro arquivos:

- `src/core/agent/tool-definitions.ts` — definições das 6 ferramentas disponíveis
- `src/core/agent/tool-executor.ts` — executa as ferramentas decididas pelo LLM
- `src/core/agent/agent-core.ts` — o loop principal com histórico de mensagens
- `src/test-agent-core.ts` — três testes que validam o comportamento end-to-end

### As 6 ferramentas

| Ferramenta    | O que faz                           |
| ------------- | ----------------------------------- |
| `read_file`   | Lê um arquivo do projeto            |
| `write_file`  | Cria ou sobrescreve um arquivo      |
| `list_dir`    | Lista o conteúdo de uma pasta       |
| `search_code` | Busca um termo em todos os arquivos |
| `run_command` | Executa um comando no terminal      |
| `finish`      | Declara que a tarefa foi concluída  |

### O loop

```
1. Monta contexto (Context Builder + RAG)
2. Injeta definições de ferramentas no system prompt
3. Envia para o LLM
4. LLM responde com JSON (tool call) ou texto (resposta final)
   → JSON → executa ferramenta → resultado volta pro LLM → volta ao passo 3
   → Texto → retorna ao usuário
   → finish → retorna resumo ao usuário
5. Proteção: máximo de 15 passos
```

### Por que prompt-based tool calling

O `deepseek-coder-v2` não implementa o protocolo de function calling estruturado do OpenAI. Em vez de depender de uma API específica de cada modelo, o agente ensina o modelo a responder em JSON quando quer usar uma ferramenta. Isso funciona com qualquer modelo local — incluindo modelos futuros instalados no Ollama.

### O parser de tool calls com múltiplas estratégias

O LLM nem sempre responde JSON puro — às vezes coloca dentro de bloco ` ```json ``` `, às vezes tem texto antes. O parser tenta extrair de dentro do bloco de código primeiro, depois tenta qualquer `{...}` na resposta. Isso torna o agente robusto a variações no formato do modelo.

### O histórico crescente como memória da tarefa

A cada passo o array `messages` cresce com a resposta do LLM e o resultado da ferramenta executada. Nos passos seguintes o LLM sabe o que já fez, quais arquivos já leu e quais já criou. Sem esse histórico o agente não conseguiria completar tarefas com múltiplos passos.

### Observação do Teste 2

O agente respondeu a pergunta sobre a estrutura do `src` sem chamar `list_dir` porque o RAG já tinha essa informação no índice. O comportamento é inteligente mas a contagem de arquivos de teste ficou levemente desatualizada (disse 2, existem 5). Isso é esperado nessa etapa — nas próximas versões o agente vai ser instruído a confirmar informações estruturais com `list_dir` antes de responder.

### Resultado dos testes

```
✅ Teste 1: Respondeu sobre as 4 ferramentas usando contexto do RAG
✅ Teste 2: Descreveu estrutura do projeto com base no índice
✅ Teste 3: Chamou write_file, criou o arquivo e confirmou em 2 passos
✅ Loop de tool calling funcionando end-to-end
✅ Passos exibidos em tempo real com 🤔🔧📋💬
✅ Arquivo de teste limpo após execução
```

---

_README atualizado após conclusão da Etapa 7_

---

## Etapa 8 — agent init (concluída ✅)

### O que foi construído

O `agent init` é o primeiro comando real que o usuário executa em um projeto. Detecta a stack, resolve ambiguidades perguntando ao usuário, indexa o codebase no RAG e salva `.agent/config.json` com tudo que foi descoberto.

### Fluxo

1. Verifica se o Ollama está rodando
2. Detecta a stack com o Stack Detector (Etapa 3)
3. Exibe o que foi detectado — campos não detectados aparecem com `?`
4. Pergunta ao usuário apenas os campos com ambiguidade (banco, arquitetura, linguagem)
5. Confirma antes de indexar
6. Indexa o projeto com o Indexer (Etapa 5) — pula `package-lock.json`, `vectors.json` e lock files
7. Salva `.agent/config.json` com stack completa e config do Ollama
8. Adiciona `.agent/` ao `.gitignore` automaticamente

### O AgentConfig

Estrutura salva em `.agent/config.json` — lida por todos os comandos seguintes:

```typescript
{
  version, createdAt, projectRoot,
  profile: StackProfile,   // tudo que o detector descobriu
  ollama: { baseUrl, defaultModel, fastModel, embeddingModel }
}
```

### Arquivos ignorados na indexação

`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `vectors.json`, `.env` e variantes. Lock files chegam a milhares de linhas sem valor semântico para o RAG. O índice vetorial não indexa a si mesmo.

### Resultado dos testes

```
✅ Ollama verificado antes de começar
✅ Stack detectada: typescript, npm
✅ Ambiguidades resolvidas via prompt interativo
✅ Indexação concluída ignorando arquivos desnecessários
✅ .agent/config.json criado com versão, stack e config do Ollama
✅ .agent/index/vectors.json gerado (3002kb)
✅ .agent/ adicionado ao .gitignore automaticamente
✅ loadConfig retornou a config correta em chamada subsequente
```

---

## _README atualizado após conclusão da Etapa 8_

## Etapa 9 — agent generate (concluída ✅)

### O que foi construído

O `agent generate` é o comando principal do agente — gera código seguindo os padrões do projeto atual. Usa o Agent Core (Etapa 7) com RAG + LLM + tool calling para criar arquivos que imitam o estilo já existente no projeto.

### Uso

```bash
agent generate module payments
agent generate service users --app api
agent generate component Button --app web
agent generate page dashboard --app web
agent generate dto CreateUser
```

### Fluxo

1. Carrega `.agent/config.json` — falha com mensagem clara se não inicializado
2. Monta instrução rica combinando tipo, nome, app alvo e hints da stack detectada
3. Roda o Agent Core: o LLM explora a estrutura, lê referências e escreve os arquivos
4. Exibe lista dos arquivos criados
5. Pergunta se reindexar no RAG (com `--yes` pula a confirmação)
6. Reindexe cada arquivo criado individualmente

### Instrução rica por tipo

O `buildInstruction` monta uma instrução específica para cada tipo:

- **module** → cria `.module.ts`, `.service.ts`, `.controller.ts` e entidade se houver ORM
- **service** → classe com métodos CRUD e injeção de dependências
- **controller** → endpoints REST completos (GET, POST, PUT, DELETE)
- **page** → componente de página com estados e chamadas de API
- **component** → componente React com props tipadas
- **hook** → custom hook com estados, efeitos e retorno tipado

### Resultado dos testes

```
✅ agent generate service calculator — arquivo criado corretamente
✅ LLM explorou estrutura antes de gerar
✅ Código gerado seguindo padrões do projeto
✅ Reindexação automática após criação
✅ Funciona via CLI: agent generate module payments
```

---

## _README atualizado após conclusão da Etapa 9_

## Etapa 10 — agent run (concluída ✅)

### O que foi construído

O `agent run` executa tarefas do projeto com seleção interativa. Quando ocorre erro, analisa com o LLM e sugere correção.

### Uso

```bash
agent run              # abre menu interativo
agent run --app api    # já seleciona o app "api"
```

### Menu interativo

```
? O que você quer executar?
  🏗️  Build
  🧪 Test
  🔍 Lint / Format
  🗄️  Database (migrate/seed)
  🚀 Deploy
  ✏️  Custom (digitar comando)
```

### Funcionalidades

**Monorepo inteligente** — detecta turborepo, nx ou lerna e ajusta o comando automaticamente. `pnpm turbo run test --filter=api` em vez de `npm test`.

**Submenu de database** — migrate, migrate:dev, seed, reset e studio. Comandos adaptados ao ORM detectado (Prisma, TypeORM...).

**Output em tempo real** — usa `spawn` com `stdio: inherit` para o output aparecer diretamente no terminal, igual a rodar o comando manualmente.

**Análise de erro com LLM** — quando o comando falha, pergunta se quer analisar. O LLM recebe o comando e o código de saída, busca contexto no RAG e sugere a correção.

### Resultado dos testes

```
✅ Comando registrado no CLI
✅ run.ts importado sem erros de compilação
✅ Funcional via: npm run dev -- run
```

---

## _README atualizado após conclusão da Etapa 10_

## Etapa 11 — agent chat (concluída ✅)

### O que foi construído

O `agent chat` é uma conversa livre com o agente no contexto do projeto. Responde com streaming em tempo real, mantém histórico da sessão em memória e persiste em `.agent/history.json`.

### Uso

```bash
agent chat
```

### Funcionalidades

**Streaming em tempo real** — a resposta aparece sendo digitada, igual ao ChatGPT. Usa o método `stream()` do OllamaProvider.

**Histórico em memória** — o LLM recebe as últimas 20 mensagens da sessão em cada requisição, mantendo continuidade da conversa.

**RAG automático** — cada mensagem do usuário busca contexto relevante no índice antes de enviar ao LLM. O agente responde baseado no código real do projeto.

**Histórico persistido** — ao sair, salva em `.agent/history.json`. Máximo de 100 mensagens.

**Comandos especiais:**

```
/sair      → encerra e salva histórico
/limpar    → limpa sessão e disco
/historico → exibe mensagens da sessão
/ajuda     → exibe comandos disponíveis
```

### Resultado dos testes

```
✅ chat.ts importado sem erros
✅ chatCommand e runChat exportados corretamente
✅ Comando "chat" registrado no CLI
✅ Histórico salvo e carregado corretamente
✅ Funcional via: npm run dev -- chat
```

---

## _README atualizado após conclusão da Etapa 11_

## Etapas 12, 13 e 14 — Wizard, Templates e Memória (concluídas ✅)

### O que foi construído

As três últimas etapas completam o `agent new` — o comando que cria projetos do zero.

**Arquivos criados:**

- `src/core/wizard/stack-wizard.ts` — wizard interativo de stack (Etapa 12)
- `src/core/templates/template-engine.ts` — gerador de arquivos base (Etapa 13)
- `src/core/memory/profile-memory.ts` — salva e carrega perfis em ~/.agent/profiles/ (Etapa 14)
- `src/commands/new.ts` — orquestra tudo

### Uso

```bash
# Cria projeto com wizard
agent new meu-projeto

# Reutiliza um perfil salvo (pula o wizard)
agent new meu-projeto --profile nestjs-prisma-ddd
```

### Etapa 12 — Stack Wizard

Pergunta interativa em sequência:

1. Tipo do projeto (Backend / Fullstack / Frontend / Mobile / Monorepo / CLI)
2. Linguagem (TypeScript, JavaScript, Python, PHP)
3. Framework de backend (NestJS, Express, Fastify, Django, FastAPI, Laravel)
4. Framework de frontend (Next.js, React+Vite, Vue, Angular, Nuxt)
5. Banco de dados + ORM
6. Arquitetura (Simples, Modular, MVC, DDD)
7. Package manager + framework de testes
8. Pergunta se quer salvar como perfil

### Etapa 13 — Template Engine

Gera arquivos base embutidos no código — sem dependência de rede ou arquivos externos:

- `package.json` com scripts configurados
- `tsconfig.json` com configurações corretas para a stack
- `src/main.ts` com boilerplate do framework
- Estrutura de pastas por arquitetura (modular, DDD...)
- `prisma/schema.prisma` com provider correto
- `.env.example`, `.gitignore` e `README.md`

### Etapa 14 — Profile Memory

Salva stacks favoritas em `~/.agent/profiles/` (global, não por projeto):

```bash
# Salva durante o agent new
? Salvar essa stack como perfil para reusar depois? Yes
? Nome do perfil: nestjs-prisma-ddd

# Usa em projetos futuros
agent new novo-projeto --profile nestjs-prisma-ddd
```

### Resultado dos testes

```
✅ stack-wizard.ts importado sem erros
✅ template-engine.ts importado sem erros
✅ profile-memory.ts importado sem erros
✅ new.ts importado sem erros
✅ Template Engine gerou arquivos para NestJS + Prisma sem I/O
✅ Profile Memory: salvar, carregar, listar e deletar funcionando
✅ Perfis persistidos em ~/.agent/profiles/
✅ Comando "new" registrado no CLI
```

---

_README atualizado após conclusão das Etapas 12, 13 e 14_

-
