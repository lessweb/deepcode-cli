# Plan Mode Benchmark: Quality, Efficiency & Cost Analysis on an Identical Task

> **Model**: deepseek-v4-pro
> **Date**: 2026-07-17
> **Sessions**: Plan Mode (`5fa1934d`), Non-Plan (`ce7157e1`)

---

## Abstract

We conducted a controlled A/B experiment to evaluate the impact of Deep Code's Plan Mode on four dimensions: **result quality, wall-clock time, token consumption, and real cost**. Two sessions were launched simultaneously on the same task using the same model (`deepseek-v4-pro`) — one with Plan Mode enabled, one without. This simultaneous setup eliminates the confounding effect of API-side compute fluctuations across time windows.

**Core finding**: Plan Mode traded a **26% cost increase** and **32% time increase** for a **quality leap from 0% to 75% correctness**. Additionally, its reasoning density (Reasoning Ratio) was nearly **1.5×** that of the non-Plan session, indicating that Plan Mode effectively steers the model toward deeper analytical behavior.

---

## 1. Experimental Design

### 1.1 Task Description

The agent was asked to solve a real-world, non-trivial Python problem.

> Full task description and test data on GitHub: [qorzj/deepcode-qrcode-benchmark](https://github.com/qorzj/deepcode-qrcode-benchmark)

### 1.2 Controlled Variables

| Variable | Plan Mode Group | Control Group |
|----------|----------------|---------------|
| Model | `deepseek-v4-pro` | `deepseek-v4-pro` |
| Thinking Mode | Enabled | Enabled |
| Reasoning Effort | max | max |
| Start Time | 2026-07-17 03:07:49 UTC | 2026-07-17 03:07:45 UTC |
| Initial Prompt | Identical | Identical |
| Working Directory | Identical project copy | Identical project copy |
| Plan Mode | ✅ Enabled | ❌ Disabled |

Both sessions launched simultaneously, effectively controlling for performance variance caused by DeepSeek official model load and compute fluctuations across different time periods.

---

## 2. Result Quality

### 2.1 Decoding Results

| Test Image | Plan Mode | Non-Plan |
|-----------|-----------|----------|
| `1.png` | ❌ Garbled | ❌ Pure digits |
| `2.png` | ✅ Correct | ❌ Pure digits |
| `3.png` | ✅ Correct | ❌ Pure digits |
| `4.jpg` | ✅ Correct | ❌ Mixed alphanumeric garbage |
| **Overall Pass Rate** | **75% (3/4)** | **0% (0/4)** |

### 2.2 Qualitative Analysis

**Non-Plan (control)** exhibited a classic failure pattern: the agent rushed into coding, implementing a complete algorithmic framework (~34 KB of code covering GF(256), RS error correction, finder detection, and every other sub-module), but due to the absence of upfront planning, it suffered from a systematic misalignment in the module sampling grid. The result: all 4 images "ran" without errors, yet every output was a meaningless digit sequence — the agent never realized its results were wrong.

**Plan Mode** spent its first ~2 minutes generating a detailed implementation plan that explicitly identified each sub-module's responsibilities, interdependencies, and testing strategy. This upfront investment gave the agent clear directional awareness throughout the implementation. The 3/4 success rate demonstrates the advantage of a plan-driven methodology. The sole failure (`1.png`), the agent concluded at the end, was caused by a ~0.5 module offset in finder pattern center localization.

---

## 3. Wall-Clock Time

| Metric | Plan Mode | Non-Plan | Delta |
|--------|-----------|----------|-------|
| Wall-Clock Time | **41.9 min** | **31.7 min** | **+32%** |

Without Plan Mode, the agent requires no user approval and dives directly into implementation, leading in total elapsed time. The ~10 minute gap stems from two sources: (a) Plan Mode's ~2 minutes of upfront planning; (b) Plan Mode's tendency to analyze problems more carefully rather than trial-and-error quickly, resulting in slightly longer per-round reasoning times.

Notably, Plan Mode's **output-per-time ratio is actually higher**: Non-Plan spent 31.7 minutes producing an unusable solution, while Plan Mode's 41.9 minutes yielded a 75%-correct solution — in terms of effective output, the former simply cannot compare to the latter.

---

## 4. LLM Requests & Token Consumption

### 4.1 Request Volume

| Metric | Plan Mode | Non-Plan | Delta |
|--------|-----------|----------|-------|
| LLM Requests (Reqs) | 155 | 122 | +27% |
| Tool Calls | 158 | 132 | +20% |
| Avg. Time per Request | 16.2 s | 15.6 s | +4% |

Plan Mode generated more LLM requests not because it was "less efficient," but because it **performed more validation steps** — proactively running tests and checking intermediate results after each stage. The Non-Plan session favored "write everything, then test once."

### 4.2 Token Consumption

| Metric | Plan Mode | Non-Plan | Delta |
|--------|-----------|----------|-------|
| Input Tokens (Total) | 22,105,976 | 16,624,843 | +33% |
| Output Tokens (Total) | 173,907 | 140,742 | +24% |
| Cached Hit Tokens | 22,004,992 | 16,540,800 | +33% |
| Cache Miss Tokens | 100,984 | 84,043 | +20% |
| Reasoning Tokens | 84,743 | 44,839 | +89% |
| Active Context (Active Tokens) | 251,937 | 218,876 | +15% |

### 4.3 Efficiency Metrics

| Metric | Plan Mode | Non-Plan | Notes |
|--------|-----------|----------|-------|
| Cache Hit Rate | 99.54% | 99.49% | Nearly identical |
| Input Tokens / Request | 142,619 | 136,269 | Plan Mode +5% |
| Output Tokens / Request | 1,122 | 1,154 | Non-Plan +3% |
| Reasoning Tokens / Request | 547 | 368 | Plan Mode +49% |
| **Reasoning Ratio** | **48.7%** | **31.9%** | **Plan Mode +16.8pp** |

The most striking difference lies in the **Reasoning Ratio**: Plan Mode's agent devoted 48.7% of its output tokens to chain-of-thought reasoning rather than direct code generation or text output. This means that under Plan Mode, the model spent significantly more "brainpower" analyzing problems, evaluating approaches, and verifying assumptions — not merely "doing." This deliberative thinking pattern directly correlates with superior result quality.

---

## 5. Real Cost

Per DeepSeek official pricing (July 2026):

| Line Item | Unit Price (per 1M tokens) |
|-----------|---------------------------|
| Input (cache hit) | ¥0.025 |
| Input (cache miss) | ¥3.00 |
| Output | ¥6.00 |

### Cost Breakdown

| Line Item | Plan Mode | Non-Plan | Delta |
|-----------|-----------|----------|-------|
| Input — cache hit | ¥0.55 | ¥0.41 | +¥0.14 |
| Input — cache miss | ¥0.30 | ¥0.25 | +¥0.05 |
| Output | ¥1.04 | ¥0.84 | +¥0.20 |
| **Total** | **¥1.90** | **¥1.51** | **+¥0.39 (+26%)** |

Plan Mode's total cost was ¥1.90, a 26% increase over Non-Plan's ¥1.51 (about ¥0.39, or roughly $0.05 USD). Considering that:
- Non-Plan produced a **completely unusable** solution (¥1.51 wasted)
- Plan Mode produced a **75%-correct** solution

The marginal cost of ¥0.39 unlocks enormous incremental value — a textbook case of "spending peanuts to buy steak."

---

## 6. Conclusion

### 6.1 Why Does Plan Mode Work?

Three mechanisms emerge from the data:

1. **Forced Upfront Planning**: Plan Mode requires the agent to output a `<proposed_plan>` before writing code, essentially front-loading the model's reasoning capacity into the problem-understanding phase. Evidence: Plan Mode's Reasoning Ratio of 48.7% far exceeds Non-Plan's 31.9%.

2. **Incremental Validation**: Plan Mode agents tend to run tests after completing each stage rather than writing everything in one go. Evidence: Plan Mode's tool call mix shows a notably higher proportion of test-execution commands (`bash python test_*.py`). This "small-step, fast-feedback" strategy reduces the risk of compounding errors.

3. **Context Anchoring**: The plan generated during Plan Mode serves as a cognitive anchor, helping the model maintain goal consistency throughout long sessions. The Non-Plan session exhibited noticeable "goal drift" in later stages — the agent forgot that the core objective was "correct decoding" and fell into a local optimum of "make the code run."

### 6.2 When to Use Plan Mode

Plan Mode is not a silver bullet. Based on this experimental data, we recommend:

- **Strongly recommended**: High-complexity algorithm implementation, architecture design, multi-module collaborative development, tasks requiring end-to-end verification
- **Can skip**: Simple scripts, one-off data processing, low-risk changes (typo fixes, config updates)
- **Diminishing returns threshold**: When task complexity is low enough that the agent can complete it within 3 turns, Plan Mode's upfront planning cost likely exceeds its benefits

---

*Experimental data is reproducible via Deep Code session transcripts. Plan Mode session ID: `5fa1934d-d738-4f07-aaae-8e0b80f7b2ae`; Control session ID: `ce7157e1-bf12-404b-9e35-72027a4a55ed`.*
