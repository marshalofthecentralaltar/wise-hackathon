# After sprint one

Nothing on this page is being built. Sprint one is the run in [`CONTEXT.md`](CONTEXT.md), and the team decided on 13 November 2026 to stick to it. This page keeps what the conversations with Wise people asked for beyond it, so it is not lost.

Each item names who raised it. Nobody has checked any of it against a real system.

## More places reports come from

- The support tool itself, Zendesk or Twilio. Raised by two Wise engineers; neither was sure which tool Wise uses.
- Old GitHub issues, swept for small bugs that were never fixed. Raised by the team.
- App store reviews and low ratings. Raised by the team.

## More evidence to check

- Front-end errors from Rollbar. Raised by two Wise engineers.
- A log system such as Loki, in place of the card app's own log lines. Raised by two Wise engineers.
- The gradual rollout: which changes passed their check on a small share of traffic. Raised by an on-call engineer.

## A wider search

- Every repository of a company with thousands of services. Raised by an on-call engineer. Sprint one has this as "search across two or three repositories", dropped first if time runs short.
- A service that fails because another service it calls is overloaded. Raised by an on-call engineer.
- A company's real map from web path to service to team, in place of the owners file. Raised by two Wise engineers.

## More to hand back

- A sentence for customers that a support lead approves before agents use it. Raised by a person who works on major incidents in support. Sprint one posts the sentence as plain text.
- An answer to "is there customer impact?" for every incident. Raised by the same person.
- A rollback button. Raised by an on-call engineer, who said a button is fine and rolling back automatically may be dangerous.
- An offer to page the owning team. Raised by an on-call engineer.
- A postmortem draft written from the incident's Slack channel. Raised by an on-call engineer.

## Sold by others already

- Rollback suggestions, paging and postmortem drafts for monitoring alerts are sold by incident.io, PagerDuty and Rootly, as found by search on 13 November 2026. We have not used them.
- When the team said the idea was to automate the whole on-call flow, the on-call engineer's answer was lukewarm.

## Missing for any version

- A number for how often a problem reaches engineers through customers and not through monitoring, and for the time the tool would save. Three people were asked on 13 November and none gave one. Issue #8 holds the questions.
