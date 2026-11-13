# Support message fixture

`reports.json` holds 60 support-channel messages that test the tool's grouping and severity decisions (issue #3). One object per message:

```json
{ "id": "r01", "text": "...", "lang": "en", "is_report": true, "page": "card", "problem": "card-picture-flicker", "severity": "low" }
```

`lang` is `en`, `et` or `ru`. `page`, `problem` and `severity` are `null` when `is_report` is `false`.
Validate with `node fixtures/validate.mjs`. It prints `OK 60 messages` and exits 0, or prints one `FAIL` line per problem and exits 1.
