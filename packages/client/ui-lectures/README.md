---
description: "Lecture quiz widget for the dsh web client: the end-of-lecture quiz with folded answers, the lecture pipeline status, and a Quiz me session, over the lectures Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-lectures

## Summary

A Home dashboard widget (`lectures.quiz`) over the [lectures](../../external/lectures/README.md) Remote namespace. It lists lectures still moving through the pipeline with their stage and a **Make quiz now** action, then the most recent quiz: each question with its kind and a **Show answer** toggle, with math rendered through KaTeX. **Older** and **Newer** page through past quizzes. **Quiz me** creates a session with the `academic` agent preset and queues a prompt that asks the questions one at a time and grades each answer against the reference answer. The widget refreshes every 30 seconds.

On each [class page](../ui-agenda/README.md) it adds a **Study** card (`course.section`): the class's five most recent lectures with their stage, its master notes' lecture count, the latest quiz with **Quiz me**, and **Plan what to study**, which starts an `academic` session asking for this week's study plan from the class's deadlines and notes.

## Use this package

Mount it in the Client plane with the dashboard and the `lectures` Host service.

## Model Experience

**Quiz me** sends one user message: the course, lecture, and date, grading instructions, the lecture note path, and each question with its reference answer. **Plan what to study** sends one user message naming the class, asking the model to use the `course` tool and the class's notes, and listing the most recent lectures. Both become part of the session log like any typed prompt.

## Known Limitations and Deferred Work

- The pipeline has no settings UI yet; settings are edited in `$DSH_HOME/lectures/config.json` or through `lectures/setSettings`.
