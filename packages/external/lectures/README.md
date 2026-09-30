---
description: "Lecture pipeline: Notability lecture notes transcribed into the vault, a LaTeX master document per course, and end-of-lecture quizzes over the lectures Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-lectures

## Summary

Turns handwritten lecture notes into course notes and a quiz without any manual step. The service scans Notability's iCloud folder every `pollSeconds` and follows notes created on or after `since` that belong to a followed course. The course comes from the note title (`STAT 536 Lec 3`), its Notability subject, or a class on the calendar ([connectors](../connectors/README.md)) within `calendarSlackMinutes` of the note's creation, so untitled `Note Sep 30, 2026` notes still match.

| Step | When | Output |
|---|---|---|
| Transcribe | the note has gone `settleMinutes` without edits | Every page OCR'd with the memory service's vision model, exported to `<vaultDir>/<school>/<course>/<date> <title>.md` ([memory-notability](../../memory/memory-notability/README.md)). |
| LaTeX | the transcript changed | `<texDir>/lectures/<date>-<title>.tex`, written by the `writer` model from the transcript in the template's macros and environments. |
| Master notes | at the first scan for every configured course, then after each LaTeX write | `<texDir>/<masterName>.tex`, created from the template, `\input`s every lecture in date order between the `%% tteoki:lectures` and `%% tteoki:lectures:end` lines and is compiled with `latexmk` to a PDF beside it. Only that block is rewritten, so sections the user adds elsewhere stay. A compile error in the new lecture gets one repair attempt by the writer model. |
| Index | after each transcription | `memory.index` on `knowledgeBase`. |
| Quiz | once per lecture, after `quizAfterMinutes` without edits | 4–6 questions (proofs, concepts, computations) with answers: `<course>/Quizzes/<date> <title> Quiz.md` with folded answers, and `$DSH_HOME/lectures/quizzes/<id>.json`. |

Page OCR is cached by image hash, so re-transcribing an edited note sends only changed pages to the vision model.

## Use this package

Mount it in the Host plane beside `memory` (required) and `connectors` (optional: course names and the calendar). Settings live in `$DSH_HOME/lectures/config.json`; state in `state.json`.

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Whether the watcher runs; turning it on requires `notabilityDir`, `vaultDir`, `quarter`, and `since`. |
| `notabilityDir` / `vaultDir` / `school` | — / — / `UW` | Notability `Documents` folder; vault folder receiving `<school>/<course>/`. |
| `quarter` / `since` | — | Master document title; first day (`YYYY-MM-DD`) of followed notes. |
| `courses` | `[]` | Followed course codes; empty follows every connectors course (including its aliases) plus every course code that starts a calendar event title. |
| `pollSeconds` / `settleMinutes` / `quizAfterMinutes` / `calendarSlackMinutes` | `60` / `3` / `15` / `15` | Scan interval and quiet periods. |
| `writer` | unset | `{ baseUrl, model, apiKeyEnv }` of a hosted chat model for LaTeX and quizzes; the local memory chat model when unset. |
| `template` | built-in article | Template of new master notes; it must contain a `%% tteoki:lectures` line, and may use `{{course}}`, `{{name}}`, `{{quarter}}`, `{{author}}`, `{{instructor}}`. |
| `texDir` / `masterName` | vault `<course>/LaTeX` / `{{course}} - {{name}}` | Master notes folder and file name; `{{course}}`, `{{name}}`, `{{quarter}}` are substituted. |
| `author` / `instructors` | `''` / `{}` | Template values; `instructors` maps a course code to its instructor. |
| `latexmk` | `latexmk` | The `latexmk` executable; empty skips compiling. |
| `knowledgeBase` | unset | Knowledge base re-indexed after each transcription. |

| Method | Behavior |
|---|---|
| `getSettings` / `setSettings` | Read or update settings; `null` clears `writer`, `template`, or `knowledgeBase`. |
| `status()` | Followed lectures with stage, files, and last error; each configured course's master notes, PDF, and lecture count. |
| `scan()` | Scan now and advance every due lecture. |
| `process({ id })` | Transcribe and quiz one lecture now, ignoring the quiet periods. |
| `quizzes({ limit? })` | Recent quizzes. |

Lecture LaTeX files are regenerated when their note changes; write your own material in the master notes outside the lecture block. Untitled notes (`Note Sep 30, 2026`) are titled `Lecture`.

## Model Experience

None directly. The [lecture quiz widget](../../client/ui-lectures/README.md) starts a chat whose first user message lists the quiz questions and reference answers.

## Known Limitations and Deferred Work

- Notes are found by scanning Notability's legacy iCloud `Documents` folder; notes that Notability stores only in its CloudKit database are not seen.
- A lecture whose writer output still fails to compile after one repair keeps the master PDF from updating until the note or template changes.
