# Instructions for coding agents

1. Read `docs/CONTEXT.md` completely before anything else. Its "Contracts" section is fixed; build to it exactly.
2. Work on exactly one issue. Read it with `gh issue view <number>`. The issue text is the specification.
3. Build what the issue lists and nothing more. Touch only the folder it names. If the issue and the context file disagree, stop and comment on the issue.
4. Use Node 22. Add no dependency unless the issue allows it.
5. Put no secret in any file. Never commit a `.env` file.
6. Use no name, logo or colour of Wise or of any real company.
7. Run every proof command in the issue. A proof that fails is reported with its output; it is never described as passing.
8. Branch from `main` as `issue-<number>-<short-name>`. Open a pull request to `main` titled `#<number> <issue title>`, with `Closes #<number>` and every proof command with its output in the description. Do not merge it.
9. Stop when every proof passes and the pull request is open.
