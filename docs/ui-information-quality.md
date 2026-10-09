# UI information quality (UIQ-01)

`leerness ui information --stdin --json` compares up to 16 caller-described UI items. It is read-only and advisory. It does not inspect a browser, understand paraphrased copy by itself, remove elements, or grant review approval. The caller must verify the declared metric identity, data lineage, screen state and added purpose against the actual UI.

Send one UTF-8 JSON document (maximum 65,536 bytes) to standard input:

```json
{
  "schema": "leerness.ui-information-input/v1",
  "items": [
    {
      "id": "sales-card",
      "logicalId": "card-1",
      "viewId": "desktop-overview",
      "metricId": "gross-sales",
      "lineageId": "orders.gross.sum",
      "questionId": "how-much-was-sold",
      "scope": { "subject": "all-shops", "filter": "all", "period": "2026-09", "snapshot": "2026-09-23", "unit": "KRW", "aggregation": "sum" },
      "purpose": "none",
      "purposeReason": null
    },
    {
      "id": "revenue-card",
      "logicalId": "card-2",
      "viewId": "desktop-overview",
      "metricId": "gross-sales",
      "lineageId": "orders.gross.sum",
      "questionId": "how-much-was-sold",
      "scope": { "subject": "all-shops", "filter": "all", "period": "2026-09", "snapshot": "2026-09-23", "unit": "KRW", "aggregation": "sum" },
      "purpose": "none",
      "purposeReason": null
    }
  ]
}
```

This pair is a `duplicate-candidate`: the same declared fact answers the same question in one view, with no added purpose. The command reports input indices and static reasons, not IDs, metric values or copied page text. Missing identity, lineage, question or scope returns `unknown`. Different metric names sharing a lineage and question require `semantic-review`, because names alone cannot establish whether they are copies. Different periods or units remain distinct and should be labeled visibly. Detail, trend, comparison, composition, accessibility, navigation and warning purposes require a short `purposeReason`; an unsupported purpose remains `unknown`.

`logicalId` groups DOM and accessibility observations of one element. `viewId` identifies one simultaneous rendered viewport state; different IDs are declared separate states, not verified visibility. Equal displayed numbers alone are deliberately not an input to the decision. Confirm findings with the actual rendered screen and its data source before editing. Existing UI boundary security and instruction-leakage checks remain separate.
