# Skill: Excel Automation

## When to use
Use this when generating, editing, validating, or summarizing Excel workbooks.

## Rules
- Never overwrite the original workbook without creating an output copy.
- Preserve formulas, formatting, merged cells, filters, widths, and hidden sheets unless explicitly asked to change them.
- For data transformations, keep a clear before/after summary.
- Do not store personal data or credentials in harness files.

## Procedure
1. Identify workbook purpose, key sheets, and required output.
2. Inspect structure before editing.
3. Apply the minimum necessary transformation.
4. Validate row counts, formulas, and totals.
5. Save a new output file.
6. Update `.harness/session-handoff.md` with what changed.

## Output checklist
- Changed sheets
- Added/removed columns
- Validation result
- Output filename
