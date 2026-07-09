# Deep Code Architecture: A Harness Built Around the DeepSeek Model

The quality of a Coding Agent is not determined by the model alone. It is determined by the system formed by the model (LLM) and its execution framework (harness).

Deep Code's ultimate goal is this: on intelligent coding tasks, Deep Code should achieve better results than the "Claude Code + DeepSeek" combination, while costing less. The path to that goal is not to imagine that one generic framework can make every model perform at its best. Instead, it is to continuously adapt the framework to the latest DeepSeek models, so that the tool shapes, context layout, safety rules, and recovery paths seen by the model all match how it actually behaves.

## Why This Goal Is Feasible

Armin Ronacher's article ["Better Models: Worse Tools"](https://lucumr.pocoo.org/2026/7/4/better-models-worse-tools/) points out an important fact: tool schemas are not "neutral." Models do not treat tool schemas as pure abstract contracts to follow. They approach them with usage habits formed during training and reinforcement learning. If a vendor primarily trains a model against one mainstream framework, the model may become very good at that framework's tool ecosystem, yet unexpectedly unreliable when facing tools with a different shape. A more capable model may form stronger habits, and stronger habits can make it more resistant to unfamiliar tools.

This observation is the core basis for Deep Code's design. Claude Code is a closed-source framework optimized for Anthropic models, and it has no reason to treat DeepSeek as a first-class target. Deep Code makes a different choice: it becomes part of the DeepSeek ecosystem. It should be tuned specifically for DeepSeek, not merely be "compatible" with it.

## Core Design 1: Repairing Tool Calls Through Snippets

Traditional editing tools often require the model to provide a file path plus large `old_string` and `new_string` payloads. That looks straightforward, but in real-world scenarios it has many typical failure modes: the model may edit a stale view of a file, match the wrong repeated block, accidentally include line numbers, lose indentation, over-replace text, or generate JSON with incorrect escaping. The result is either a failed tool call or, worse, a plausible-looking but actually incorrect file change.

Deep Code's solution is the snippet system. In addition to returning file contents, the `read` tool maintains session-local file state for text files and returns a `snippet_id` in metadata. The `edit` tool then requires this `snippet_id` as a mandatory parameter. A snippet carries the file path, line range, preview, version, and scope type.

This reshapes the editing contract: a file must be read before it can be edited; the snippet must exist in the current session; the file must not have changed since it was read; replacement is searched only within the snippet's scope; non-unique matches return candidate snippets instead of guessing; and bulk replacement can require declaring the expected number of occurrences.

This is a repair strategy that understands model behavior rather than indulging it. It does not require the model to stay perfect under pressure. Instead, it makes the correct operation easier to express while giving the framework enough local information to detect ambiguity. It remains strict at the interface validation layer, but is tolerant of common, recoverable text mistakes made by coding agents, allowing the agent to keep moving forward when the intent is clear.

The built-in tools are intentionally small and focused: `bash`, `read`, `write`, `edit`, `AskUserQuestion`, `UpdatePlan`, and `WebSearch`, while external MCP tools are mounted dynamically. This is a deliberate design decision. It reduces schema uncertainty, makes permission analysis feasible, and gives the model a predictable and repeatable action language.

## Core Design 2: Cache-Aware Context Management

The second core design is using context caching to control cost. DeepSeek's context cache is enabled by default. When a later request fully reuses a cached prefix unit, it can hit the cache, and the response reports the number of cache-hit and cache-miss tokens. This is a best-effort system, but it does reward stable repeated prefixes.

Deep Code's session architecture is designed around this property, without requiring users to cooperate manually. Stable content such as the system prompt, tool documentation, default skills, runtime context, and project instructions is placed before volatile user content. Session messages are persisted as JSONL and can be replayed consistently. Tool-call and tool-result pairings are repaired during conversion, including interrupted tool calls, so the conversation sent back to the model always remains structurally valid.

## Core Design 3: Context Engineering Centered on Agent Skills

A coding agent should not stuff all knowledge into its context. Doing so pollutes the context, raises cost, and weakens instruction priority. At the same time, many tasks do require reusable knowledge: code review workflows, domain conventions, framework-specific patterns, and so on. Agent Skills are the mechanism for loading this knowledge on demand, exactly when it is needed.

Automatic matching also uses the model itself: the system sends candidate skill names and descriptions to the model, and the model returns the skills that should match. Already-loaded skills are not loaded again, and skills can declare that they should not participate in implicit invocation. This design keeps the base framework lean while allowing rich task-specific behavior, and it also makes skills portable across tools.

The deeper architectural meaning is that skills are not plugins in the traditional sense. They are structured context. They let the framework decide when to introduce instructions, examples, templates, scripts, and reference files into the conversation. For models with strong but imperfect generalization, this is exactly the right abstraction: keep the default environment clean, and inject precise prior knowledge only at the moment when it is truly helpful.

## Core Design 4: A Permission System Based on Side-Effect Classification

Intelligent coding inevitably involves real side effects: reading and writing files, running shell commands, accessing the network, and calling external tools. A framework that only provides a "fully automatic mode" is unsafe, while prompting for everything is too slow. Deep Code's innovation is to introduce a scope policy based on side-effect classification.

The permission system defines concrete scopes, such as reading, writing, and deleting inside or outside the working directory; querying and mutating Git history; network access; MCP; and so on. The `bash` tool requires the model to declare the side effects of the current operation, while file tools are classified directly based on their paths.

This is not merely a safety feature. It is itself part of agent quality. Permissions give the model a predictable operating boundary: low-risk work can proceed quickly, while high-risk actions stop for confirmation. It also makes command behavior auditable: a command is not just text waiting to be executed, but a combination of text, declared side effects, and a policy decision.

## Benchmark

Deep Code's advantage does not come from a single clever trick. It comes from the compounding effect of a series of decisions. The [deepcode-qrcode-benchmark](https://github.com/qorzj/deepcode-qrcode-benchmark) project shows that on a real and challenging Python requirement, the combination of Deep Code + DeepSeek + `/plan` mode can consistently outperform the combination of Claude Code + DeepSeek.
