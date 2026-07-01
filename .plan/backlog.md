# DeepCode CLI — Backlog de Contribuições

## Keybindings / UX

- [ ] `exit` command — sair da CLI de forma limpa
- [ ] `Esc Esc` — atalho para undo (mais ergonômico que `/undo`)

## Skills bundled (PR upstream)

- [ ] **plan-verify** — skill de verificação pós-implementação que:
  - Relê o `<proposed_plan>` original da sessão
  - Extrai todos os deliverables prometidos (seções: Implementation Changes,
    Test Plan, etc.)
  - Compara contra o que foi realmente entregue (arquivos alterados, testes
    escritos, commits feitos)
  - Lista itens faltantes e cobra do agente antes de declarar "pronto"
  - Trigger: final de implementação, quando UpdatePlan marca tudo `[x]`
  - Problema que resolve: agente cumpre checklist de código mas ignora
    deliverables do plano (ex: promete testes no Test Plan e não escreve)

- [ ] **engineering-standards** (versão genérica) — concurrency, file I/O,
  atomicity, testing, pre-commit checklist. Adaptado do que já funciona em
  `~/.agents/skills/engineering-standards/SKILL.md`, sem referências a projetos
  específicos.
