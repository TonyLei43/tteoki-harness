---
description: "Parallel runs panel for the dsh web client: fan one prompt out to agents in separate git worktrees, compare and review their diffs, and merge the chosen lane."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-parallel-runs

## Summary

The **Parallel** panel sends one prompt to several agents, each in its own git worktree, then lets you compare what each one changed, send line comments back to an agent, and merge the best lane. It drives the [worktrees](../../workspace/worktrees/README.md) Remote namespace for worktrees and the `session` and `agentPresets` namespaces for the agents.

## Use this package

Mount it in the Web client roster next to a Host-plane `@deepseek-ai/dsh-worktrees` row. It adds a **Parallel** sidebar entry.

- **New run** takes a folder inside a git repository, a prompt, and one agent preset per lane (up to 8). Starting creates the worktrees, then one session per lane in its worktree with its preset, and sends each session the prompt.
- **View changes** shows a lane's diff against the run's starting commit, including uncommitted and untracked files. Click any line to comment on it; **Send to agent** sends the comments to that lane's session as one follow-up message naming each file, line, and quoted code.
- **Merge** commits the lane's changes and merges its branch into the repository's checked-out branch after you confirm the commit message. One lane per run can merge; a conflict is aborted and reported.
- **Discard run** deletes the run's worktrees and branches after confirmation.

## Model Experience

Review comments reach the lane's agent as an ordinary user message, so they are logged like any prompt. The message lists `path, line N: \`code\`` with the comment under each item and ends by asking the agent to address every comment and summarize its changes.

## Known Limitations and Deferred Work

- Lane status shows whether a session is attached, not whether its agent is still running; open the session to see progress.
- **Runtime invariant:** No companion is published. The panel holds only view state; runs live in the worktrees service.
