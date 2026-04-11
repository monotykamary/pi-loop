---
name: pi-loop
description: Close the loop — a self-verification playbook for completing tasks with confidence. Use when a task requires verification before completion, involves multiple files or behavioral changes, or when you want to ensure high-quality outcomes through disciplined self-checking.
---

# Close the Loop

**The art of finishing what you started, with proof.**

There is a gap between "I think I'm done" and "I know I'm done." This playbook teaches you to close that gap through a simple discipline: **verify with different eyes than you used to create.**

## When to Use This Playbook

You feel the need to close the loop when:

- The task touches multiple files or changes behavior
- You're refactoring, not just adding
- The user cares about correctness, not just progress
- You've been burned before by thinking you were done when you weren't
- You want to build trust through demonstrated care

Trust the feeling. When in doubt, close the loop.

## Activating the Loop

When you detect a task needs this discipline, **invoke the `start_loop` tool** before you begin working:

```
start_loop({
  outcome: "Refactor auth to use dependency injection with full test coverage"
})
```

This activates an external observer who will validate that you properly close the loop. The observer checks:

- You verify with different tools than you used to create
- You don't declare "done" without demonstrated proof
- You don't game your own verification

Think of it as announcing: "I'm entering disciplined mode. Watch me work."

The observer only activates when you call the tool. If you forget, you're working without a safety net.

## The Discipline

The loop has three phases. Skip none.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    WORK     │────→│   VERIFY    │────→│   CONFIRM   │
│             │     │             │     │             │
│ Create with │     │ Check with  │     │ Declare     │
│ edit/write  │     │ read/search │     │ with        │
│             │     │ bash/diff   │     │ confidence  │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Phase 1: Work

Use all your tools. Read, edit, write, run commands. Build. Create. Solve.

**But do not declare completion yet.**

### Phase 2: Verify (The Critical Crossing)

Here is where most fail. They look at what they made with the same eyes that made it. They see what they intended, not what they wrote. They confirm their own bias.

**You must use different tools to verify than you used to create.**

| If you created with... | Then verify with...                                    |
| ---------------------- | ------------------------------------------------------ |
| `edit` — changed code  | `read` — re-read it fresh, or `bash` — run tests       |
| `write` — new files    | `read` — inspect structure, or `search` — find orphans |
| `bash` — generators    | `read` — inspect output, or `search` — check patterns  |
| Your reasoning         | `search` or `bash` — find what you might have missed   |

**Why this works**: Different tools access different cognitive paths. When you re-read a file you edited, you don't remember what you wrote — you see what is actually there. When you search for patterns, you find what your reasoning overlooked. The loop closes because the verification is genuinely independent.

**What to verify**:

- The code actually does what you intended
- Tests pass (if they exist)
- No orphaned references (old function names, unused imports)
- No unintended changes leaked in
- The user request is fully satisfied, not partially

**Document your verification**. Write what you checked and how. This creates an audit trail you can trust later.

### Phase 3: Confirm

Only after verification do you declare completion. And when you declare, reference your verification:

> Task complete: Refactored auth to DI. Verified: re-read all modified files, ran test suite (all pass), searched for orphaned imports (none found). Confidence: 0.95.

This is the reward: the right to say "done" because you earned it through verification, not assumed it through creation.

## The Mindset

**Skepticism of self**: You are a capable creator. That is exactly why you need verification — capability creates blind spots. You see intent; verification sees reality.

**Documentation as discipline**: Write down what you verified. Not for others. For yourself, when context resets, or when doubt creeps in.

**Confidence earned, not claimed**: A confidence of 0.9 means you checked nine things and nine held. A confidence of 0.5 means you checked two things and one failed. Be honest. The loop will force you back to work anyway.

**The loop is fractal**: Large tasks contain smaller tasks. Each can have its own loop. A refactor might have: (1) change the core, (2) update call sites, (3) verify integration. Each sub-completion deserves verification.

## Example: The Auth Refactor

You are asked: "Refactor auth to use dependency injection."

**Phase 1: Work**

- Read auth.ts to understand current structure
- Edit auth.ts: add DI container, refactor functions to use it
- Edit login.ts: update call sites
- Edit signup.ts: update call sites

**Phase 2: Verify** (using different tools)

- `read` auth.ts: Is the DI wiring correct? Did I miss any edge cases?
- `bash`: pnpm test (run the test suite, get objective results)
- `search`: grep for old auth imports (find any orphans I forgot to update)
- `read` login.ts, signup.ts: Are the call sites properly updated?

**Phase 3: Confirm**

> Task complete: Refactored auth to use dependency injection. Verified DI wiring in auth.ts, all tests pass, no orphaned imports found, call sites in login.ts and signup.ts properly updated. Confidence: 0.95.

Notice: you did not just say "I refactored auth." You said what you verified and how. The difference is the difference between hope and confidence.

## Common Failures

**Verification with same tool**: You edited auth.ts, then "verified" by thinking about what you edited. This is not verification. Use `read` or `bash` or `search`.

**Vague confidence**: "Confidence: high" means nothing. Use 0-1. Document what you checked.

**Skipping verification after small changes**: "It was just a one-liner." The worst bugs are one-liners. Close the loop for anything that matters.

**False verification**: Running tests but not checking if they actually passed. Searching for orphans but not fixing the ones found. Verification must be honest.

## The Simplest Form

For small tasks, the loop can be simple:

> Edited file.ts to fix the off-by-one error. Re-read the function to verify logic. Confidence: 0.9.

Even here: edit → read → confirm. The discipline scales down.

## Remember

- **Work**: Create freely, but don't claim completion yet
- **Verify**: Use different tools than you used to create
- **Confirm**: Declare done with verification log and honest confidence

Close the loop. Every time.
