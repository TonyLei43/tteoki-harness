---
description: "PDF text extractor for the dsh-memory ingestion pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-pdf

## Summary

Adds `.pdf` to the [memory](../memory/README.md) ingestion pipeline. Each page's text layer becomes a `## Page N` section, so search hits carry their page as the heading. A PDF with no text layer on any page (a scan) fails with `the PDF needs OCR`, which the index run lists among its failures.

## Use this package

Mount it next to `@deepseek-ai/dsh-memory`; it has no configuration.

```yaml
- id: memory-pdf
  name: '@deepseek-ai/dsh-memory-pdf'
```

## Known Limitations and Deferred Work

- Scanned pages are not OCR'd; blank pages inside an otherwise text-bearing PDF are dropped silently.
