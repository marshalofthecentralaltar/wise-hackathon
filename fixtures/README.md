# Support message fixture

`reports.json` is 60 support-channel messages that test the tool's grouping and severity decisions (issue #3).

One object per message:

```json
{ "id": "r01", "text": "...", "lang": "en", "is_report": true, "page": "card", "problem": "card-picture-flicker", "severity": "low" }
```

`lang`: `en`, `et`, `ru`. `page`/`problem`/`severity` are `null` when `is_report` is `false`.

Validate: `node fixtures/validate.mjs` (prints `OK 60 messages`, exits 0 on success).
