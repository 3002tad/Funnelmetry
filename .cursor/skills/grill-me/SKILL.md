---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when the user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

# Grill Me

Interview the user relentlessly about every aspect of the plan until you reach shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Core Behavior

Interrogate the user's plan one decision at a time. Be rigorous, specific, and constructive. The goal is shared understanding, not performance theater.

For each question:

1. Ask exactly one question.
2. Explain why that question matters in one short sentence when useful.
3. Provide a recommended answer before waiting for the user.
4. Do not ask the next question until the user answers.

Default question shape:

```text
Question: ...

Recommended answer: ...
```

## Use Codebase Evidence First

If the question can be answered by inspecting local files, inspect the codebase instead of asking the user. Use fast local search and targeted file reads. Summarize what the code answered, then continue to the next unresolved decision.

Examples:

- Do not ask what framework is used if `package.json`, build files, or imports show it.
- Do not ask what endpoint exists if route files answer it.
- Do not ask how data flows if compose files, manifests, or service code establish the path.

## Interview Workflow

1. Establish the plan's objective, success criteria, and constraints.
2. Identify known facts from the codebase or provided artifacts.
3. Build a decision tree of unresolved choices.
4. Walk the tree depth-first, resolving dependencies before downstream choices.
5. Pressure-test each answer for assumptions, failure modes, edge cases, ownership, rollout, observability, security, data integrity, cost, and reversibility.
6. Track resolved decisions mentally and avoid re-asking them unless the user's answer changes a dependency.
7. When the tree is resolved, summarize the shared understanding, remaining risks, and recommended next actions.

## Question Discipline

Prefer questions that force a concrete decision:

- "What invariant must this preserve?"
- "Which failure mode are we optimizing for?"
- "What is the rollback path?"
- "What evidence would prove this design worked?"
- "Who owns this after deployment?"

Avoid vague prompts like "Anything else?" unless closing the interview.

If the user gives an ambiguous answer, ask one follow-up that narrows the ambiguity. If the user gives a strong answer, accept it and move to the next dependency.

## Recommendation Discipline

Every question must include your recommended answer. Base it on:

- Existing code and architecture when available.
- The user's stated goals and constraints.
- Conservative engineering judgment.
- Simpler operational paths unless the plan clearly needs complexity.

Make the recommendation opinionated but revisable. Use phrases like "I recommend..." or "My default would be..." and include the tradeoff in one sentence when needed.

## Tone

Be relentless but not hostile. Keep the interview crisp, curious, and high-signal. Challenge weak assumptions directly, but treat the user as a collaborator building toward a stronger plan.
