---
description: "Notability note extractor for the dsh-memory ingestion pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-notability

## Summary

Adds Notability `.nbn` packages to the [memory](../memory/README.md) ingestion pipeline. Each package is one document: its title as the top heading, then typed text, Notability's own handwriting recognition per page (`## Page N`), and the text layer of each imported PDF (`## Imported PDF`). A note with none of these (handwriting Notability never recognized) fails with `the note needs OCR`, which the index run lists among its failures.

## Use this package

Mount it next to `@deepseek-ai/dsh-memory`, then add the Notability iCloud folder as a workspace source, e.g. `~/Library/Mobile Documents/<team>~com~gingerlabs~Notability/Documents`. It has no configuration.

```yaml
- id: memory-notability
  name: '@deepseek-ai/dsh-memory-notability'
```

`readNote` and `noteMarkdown` are exported for other consumers of the same package data.

### OCR and page previews

When the memory service has a vision model, handwriting-only notes are drawn from their pen strokes (`readStrokes`, `renderPages`) and transcribed page by page; previews render the same pages.

### Export to an Obsidian vault

`exportNotes` writes one Markdown note per Notability note to `<target>/<school>/<course>/<YYYY-MM-DD> <title>.md`, reading the course code from the title (`STAT 538 Lec 8`, `Stat 513 Lec16`, `STAT_512_Lectures`); notes without one go to `<target>/Unsorted/`. Front matter records the course, dates, Notability id, and a hash of the exported body. A rerun rewrites an unchanged export, leaves an identical one alone, and writes `… (from Notability).md` beside a note you edited. The `dsh tteoki notes export` command drives it:

```sh
pnpm dsh tteoki notes export --to "~/Documents/My Vault/Academic" --filter '^stat' \
  --school UW --earlier-school UCLA --since 2025-09-01 --ocr --transcribe-all
```

`--ocr` transcribes handwriting-only notes; `--transcribe-all` also replaces Notability's recognition with the vision model's (about a minute or two per page on a local 27B model).

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`metadata.plist` (`NSKeyedArchiver`, top key `root`) carries the title, UUID, subject key, and dates. `Session.plist` (`GLKeyedArchiver`, top key `$0`) carries typed text as UTF-8 bytes under `richText.NBAttributedBackingString`. `HandwritingIndex/index.plist` is a plain binary plist of recognized text per page. `NBPDFIndex/PDFIndex.zip` holds one `PDFTextIndex.txt` per imported PDF. The fingerprint is the size and modification time of those four files, so an unchanged note is skipped without parsing.

</details>

## Known Limitations and Deferred Work

- Notability's handwriting recognition is uncorrected, so math and abbreviations are often garbled; export with `--transcribe-all` to replace it with the vision model's transcription.
