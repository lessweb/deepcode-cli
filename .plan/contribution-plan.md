# DeepCode CLI — Plano de Contribuição

## Por que contribuir

- Ferramenta artesanal, poucos devs, poucas skills bundled
- O gap principal é de **prompt/guidelines**, não de runtime — e isso é meu forte
- Já mapeei os internals: cada prompt, skill, template
- Meus system prompts (AGENTS.md + skills) levaram output de 6.5/10 → 9/10
- Já uso a API DeepSeek que é o target principal da ferramenta
- Contribuições teriam impacto desproporcional no projeto

## Estado atual do built-in

### O que o DeepCode tem (pouco)

```
templates/
├── prompts/init_command.md.ejs     → gera AGENTS.md inicial (45 linhas)
├── tools/*.md                      → descrição das 6 tools (bash, read, write, edit, etc.)
└── skills/karpathy-guidelines.md   → 72 linhas, puramente comportamental

bundled/
├── plan/SKILL.md                   → 134 linhas, bom (3 fases, decision-complete)
├── skill-writer/SKILL.md           → 403 linhas, completo
├── skill-digester/SKILL.md         → review/install skills
└── deepcode-self-refer/SKILL.md    → auto-referência
```

### O que falta (e eu já resolvi no userland)

| Gap | Minha solução | Onde tá |
|---|---|---|
| Concurrency / locks | engineering-standards | `~/.agents/skills/` |
| File I/O performance | engineering-standards | `~/.agents/skills/` |
| Atomic writes | python-fastapi-patterns | `~/.deepcode/skills/` |
| Testing enforcement | engineering-standards | `~/.agents/skills/` |
| Pre-commit checklist | engineering-standards | `~/.agents/skills/` |
| Plan adherence | engineering-standards | `~/.agents/skills/` |
| Migration patterns | python-fastapi-patterns | `~/.deepcode/skills/` |
| Config resolution isolation | python-fastapi-patterns | `~/.deepcode/skills/` |
| Plan verification pós-impl | NÃO EXISTE AINDA | backlog |

## Filosofia do Mantenedor e Perfil de Review

Análise de PRs fechados/ignorados (como o PR #132 de temas e a recusa do PR de File Mention) revela a mentalidade do mantenedor (`lessweb`):

1. **"Menos Framework, Mais LLM"**: Ele prefere manter o runtime (backend Node) o mais simples e burro possível. Exemplo: prefere que o frontend apenas ajude a autocompletar caminhos (`@`) e que a IA decida chamar a tool `Read` de forma autônoma, em vez de o framework ler e injetar o arquivo de forma "não inteligente" no contexto.
2. **Aversão a Bloat de Código**: Ele rejeita PRs que introduzem muitas mudanças no backend por medo de aumentar a dívida de manutenção ("Read tool mudando de ferramenta do agente para dependência do framework").
3. **Foco em UX no Frontend**: Ele valoriza a TUI, mas é extremamente cauteloso com edge-cases de interação (ex: o que acontece se o usuário apagar caracteres no meio do caminho de um arquivo mention de forma dinâmica).
4. **Perfil Altamente Seletivo (Lento)**: PRs simples e com testes demoram semanas/meses para serem analisados ou são reescritos por ele mesmo na branch `main`.

### Implicação para a Estratégia:
- **Upstream PRs**: Precisam ser ultra-minimalistas, sem mexer na lógica do core do backend. Foco em customizações que não impõem decisões dogmáticas ao mantenedor (como aliases no settings).
- **Personal Fork**: Destinado a features que violam a regra de "simplicidade do framework" mas aumentam a sua produtividade pessoal (como o gatekeeper e a integração automática com o `agy` CLI).

## Estratégia de Contribuição: Upstream vs. Personal Fork

Dividido em duas trilhas: **Upstream PRs** (mudanças genéricas de alta aceitação) e **Personal Fork** (customizações profundas, integrações proprietárias e wrappers de agentes).

---

##  Trilha A — Upstream PRs (Mudanças de Alta Aceitação)

Foco em UX simples e habilidades genéricas que complementam o que já existe sem impor decisões dogmáticas ao mantenedor.

### PR 1 — UX & Keybindings
- `exit` command no console da CLI para sair de forma limpa.
- `Esc Esc` como atalho rápido para desfazer a última ação (`/undo`).
- *Status*: Baixo risco, atrativo para novos usuários.

### PR 2 — Melhorar a descrição da ferramenta `bash`
- Atualizar a descrição da tool `bash` (em `templates/tools/bash.md`) injetando as boas práticas operacionais do seu `AGENTS.md`:
  - Instruir explicitamente o modelo a sempre capturar saídas (`set st $status` ou `; or report_error`).
  - Mapear para comandos silenciosos (`mv`, `mkdir`, `chmod`) o append de `&& echo ok` para confirmação de runtime.
- *Status*: Corrige o comportamento padrão de execução cega de comandos.

### PR 3 — `engineering-standards` como Skill Bundled
- Propor uma versão genérica do seu `~/.agents/skills/engineering-standards/SKILL.md`.
- Remover referências específicas a este projeto (`sessions.json`, `state_lock`).
- Foco em: locks para concorrência de arquivos, evitar I/O em loops estáticos, e checklist pré-commit.
- *Status*: Fica ao lado do Karpathy Guidelines como guia técnico (Karpathy = conceitual; este = engenharia).

---

## Trilha B — Personal Fork (Minha Customização de Liderança/Staff)

Para o que o upstream recusar por ser muito específico, ou para integrações profundas com sua stack e fluxos locais.

### Feature 1 — `python-tooling` e `fish-tooling` Skills
- **`python-tooling`**: Skill bundled nativa para forçar o loop de validação (`ruff check .`, `mypy`, `pytest` via `uv` no `.venv/`). Evita erros de sintaxe ou imports que quebram o runtime silenciosamente.
- **`fish-tooling`**: Configuração e escrita de scripts executáveis nativos em `.fish` em vez de `.sh`, alinhado com o shell padrão do ambiente.
- *Status*: Muito específico do seu setup de desenvolvimento local.

### Feature 2 — Gatekeeper Determinístico no Runtime (PR 5)
- Modificação em TypeScript no runtime do DeepCode.
- Quando o `UpdatePlan` marcar tudo `[x]`, o runtime intercepta a finalização:
  - Parseia o `<proposed_plan>` original usando regex.
  - Verifica no filesystem se os arquivos da seção "Implementation Changes" têm diff no git.
  - Verifica se arquivos de teste em "Test Plan" foram criados ou alterados.
  - Se faltar algo, aborta o commit e injeta: `[Gatekeeper] Itens não entregues: X. Corrija antes de prosseguir.`
- *Status*: Transforma prompt (confiança) em código determinístico (enforcement).

### Feature 3 — Wrapper Skill `antigravity-critic` (Integração com Claude/Gemini)
- Criação de uma skill local que atua como ponte para a CLI do Antigravity (`agy`).
- Permite ao DeepCode invocar de forma autônoma revisões do Opus/Gemini no meio do seu próprio loop de escrita:
  ```bash
  git diff | agy "Faça uma auditoria de segurança focada em concorrência neste diff."
  ```
- O DeepCode lê o output da auditoria e auto-corrige o código antes do seu commit final.
- *Status*: Orquestração multi-agente local de baixo custo.

---

## Design Patterns do meta_2028 aplicáveis

Referência: `~/git/my/meta_2028/` — multi-agent Actor-Critic para otimização de CV com sandbox containerizado.

### 1. "Fails silently → code, fails loudly → prose"

Heurística central do meta_2028 para decidir o que vive em prose (runbooks .md) vs o que vive em código (Python determinístico):

| Tipo de falha | Onde vive | Exemplo no DeepCode |
|---|---|---|
| **Fails loudly** (erro visível, agent self-heals) | Prose (skill) | "use locks" — se não usar, o bug aparece em testes |
| **Fails silently** (completa sem erro, resultado errado) | Code (runtime) | Agente marca tudo `[x]` mas não escreveu os testes prometidos |

O DeepCode hoje é 100% prose (skills). O gap é que falhas silenciosas (plano não cumprido, testes não escritos) passam despercebidas porque não tem código determinístico validando.

### 2. Actor-Critic loop → plan-verify

O meta_2028 usa Karen (critic) → Bill (editor) → loop até score atingir target. No DeepCode, o equivalente seria:

```
Agente implementa → plan-verify (critic) audita deliverables
  → se faltou algo → injeta feedback → agente corrige → loop
  → se tudo OK → permite commit
```

Hoje o DeepCode tem o Actor (agente implementa) mas não tem o Critic (ninguém valida se o plano foi cumprido). A skill `plan-verify` resolve em prose; a Feature 2 (gatekeeper) resolve em código.

### 3. Gatekeeper com exit codes

O `gatekeeper.py` do meta_2028 é um módulo Python puro que:
- Parseia output do critic com regex robusto.
- Retorna exit codes determinísticos (0=success, 1=max loops, 2=continue, 3=error).
- O orchestrator nunca confia no modelo pra decidir se o loop continua.

Aplicação no DeepCode: o runtime do seu fork pode ter um mini-gatekeeper que parseia o `<proposed_plan>` e valida com checagem de filesystem (git diff, file exists) antes de aceitar o "pronto" do agente.

## Complexidade real

- **Trilha Upstream (PRs 1-4)**: Baixa. Em sua maioria apenas alteração de arquivos de markdown (`bundled/` ou `templates/`). O PR 1 envolve poucas linhas no tratador de teclado do console Node.
- **Trilha Fork (Features 1-3)**: Média/Alta. Envolve alterações no interpretador de estado do terminal da CLI (TypeScript/Node) para criar ganchos no `UpdatePlan` e interceptar o fluxo, além de scripts wrappers para o `agy`.

## Referências

- `~/.deepcode/AGENTS.md` — regras operacionais (a base)
- `~/.deepcode/skills/python-fastapi-patterns/SKILL.md` — patterns específicos
- `~/.agents/skills/engineering-standards/SKILL.md` — standards genéricos
- `~/git/my/meta_2028/` — design patterns (Actor-Critic, prose vs code, gatekeeper)
- Review que motivou tudo: commit 75fde122 no orchestrator (6.5/10 → 9/10)
