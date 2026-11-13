# Find one real problem worth building

Hours left until the demo: ___
Team: three people, one of them building with Claude Code.

## Task

We are at a hackathon run by Wise in Tallinn. The theme is "Max Ease": remove friction from an everyday experience. The organisers told us to stop thinking about Wise specifically, so the problem can sit anywhere in life: banking, transfers, daily admin, organising a company trip, anything.

Find ONE real problem we can remove with a working prototype. It needs a customer group we can name and count, proof in their own words that they suffer, and a reason the mainstream solution skips them. We start building the moment you report, so the report must be enough to build from.

This is hard. Most candidates should die. Expect to kill at least six before one survives.

## Read these completely before doing anything

- `C:\Users\ralfs\wise hackathon\wise.md`: the scoring sheet, the seven friction tests, everything already researched, and the two ideas that collapsed with the reason for each.
- `C:\Users\ralfs\wise hackathon\research\scripts\`: working scrapers and theme counters. `apple_fetch.py` pulls App Store reviews by app id and country. `googleplay_fetch.mjs` pulls Google Play reviews. `themes.py` and `synth.py` count themes and print samples.

## What scores

- Friction removal, 40%. The top mark reads: "Eliminates complex friction entirely. Solution feels effortless, highly intuitive, and accessible to all." One mark lower is "reduces effort in a real scenario". Aim for the top mark.
- Technical, 25%. A working end-to-end prototype with real APIs. Hardcoded shortcuts score 2 of 4, mock-ups score 1.
- Pitch, 25%. A live demo of the main journey.
- Creativity, 10%.

Treat the last three rows as gates: one journey, buildable in the hours left, shown live in three minutes. Earlier code of ours is allowed if we disclose it.

## The shape of a good answer

Our earlier project Ütle is the pattern. A general tool existed (voice control). It skipped a group you can name (Estonian speakers who cannot use their hands) because that market is too small for a large company. We had the means to serve them (an Estonian speech model from TalTech).

Look for that shape again: a general solution exists, a nameable group is left out by language, country, a local system, a disability, age or a rule, and we have a specific edge.

Our edges:
- Estonian language and local systems (Smart-ID, ID card, eesti.ee, the tax board, the health fund, the business register).
- Ütle's engine: Estonian speech recognised on the person's own computer, and an agent that reads any web page and acts on it, including filling forms by voice.
- Real people we can ask today: seven care-home testers in Rapla and one eye-tracker user.
- A review-scraping pipeline that collected 22,753 reviews in minutes.

Two ideas already collapsed, and you must catch that failure earlier this time:
- A bank-connection idea looked strong by theme share (13.7% of complaints). Read case by case, it would have solved 3 of 35.
- Ütle on Wise served dozens of people, and its demo hid a step the person cannot do in real life.

## Method

1. **Collect complaints in people's own words.** Use web search aggressively and the scrapers. Start where people are forced to use something: government services, banks, transport, parking, parcels, health, telecoms, utilities, group and trip organising. Begin with Estonia, where our edge is, then go wider. Read the 2 to 4 star reviews first; they come from people who stayed and hit friction.
2. **List at least eight candidate problems**, one line each: who, what they are trying to do, where they get stuck, what they do instead, how many complaints, one quote with its source.
3. **Run the kill tests in this order. Stop a candidate at its first failure and record where it died.**
   - K1 Conditions. List everything that must be true for one person to benefit. Count who passes all of it, each number marked measured or guessed. It dies if our build cannot meet a condition, or if no number is measured.
   - K2 Case by case. Take 20 to 40 real complaints and count in how many this would have ended the problem. It dies under half.
   - K3 After the demo. Name what the person must do in real life right after the last demo screen. It dies if a step remains that they cannot do or we cannot build.
   - K4 Already exists. It dies if this same group can get a working solution today. A solution that exists only for a different group is the pattern we want.
   - K5 Moat. State why the mainstream skips this group and why we can serve them. It dies on "nobody thought of it".
   - K6 Buildable. One journey on real data or real APIs in the hours left. It dies if it needs access we lack or would be hardcoded.
   - K7 A person other than us. Name who we can ask within the hour and the exact question.
4. **Score only the survivors** on the seven friction tests in `wise.md`.
5. **If everything dies, narrow.** Take the candidate that died latest, shrink the group or the task until it passes, and run the tests again. Do this up to three rounds. If nothing survives, report the nearest miss and exactly what failed.

## How to work

- Reason from first principles: start from what must be true, then check it.
- Every number carries its source and the word measured or guessed. A claim with no tool result from this session behind it is labelled unverified.
- Describe an idea neutrally until it has passed K1 to K7. Survivors get a full write-up; the dead get one line each.
- Tell me when you see a better course than the one I asked for.
- Work inline. Use agents only for independent scrapes that would otherwise run one after another.
- The deliverable is the finding. Write only scraping and analysis scripts, in the scratchpad, and copy data worth keeping into `research\data`.
- Run end to end without checking in. Pause only if a source needs credentials or money.
- Append findings to `wise.md` under a new dated heading as you go.

Practical notes for this machine:
- Reddit and Trustpilot refuse direct requests. Reach their content through web search and leave it there.
- Find an App Store app id with `https://itunes.apple.com/search?term=<name>&country=ee&entity=software`.
- Run Python with `PYTHONIOENCODING=utf-8`, or printing reviews fails.
- Run the scripts from `C:\Users\ralfs\wise hackathon\research`. `python scripts/apple_fetch.py <out.jsonl> <app id>` and `node scripts/googleplay_fetch.mjs <out.jsonl> <package name>` fetch any app; without the last argument they fetch Wise. `themes.py`, `synth.py` and `sample.py` read the two Wise files in `data\` and their keyword lists are Wise-specific, so copy and adapt them for a new app.
- The Google Play script needs `npm install google-play-scraper` in a scratch folder; copy the script into that folder and run it there, because the package is not installed in the project. It returned nothing for mismatched pairs such as English with the US store; matching language and country pairs worked.
- The Hacker News search API and the Stack Exchange API are open.

## Report

Reply in chat, under 450 words plus one table, in this order:

1. The surviving idea in one sentence a stranger understands.
2. Customer: who they are, how many (measured or guessed), where to find three of them today.
3. Proof: complaint count, three quotes with sources, and the case-by-case result as n of m.
4. Moat: why the mainstream skips them and why we can serve them.
5. The demo journey in at most five steps, then what happens in real life after the last step.
6. The friction score on the seven tests, one line each.
7. What died, and at which test, one line each.
8. The one question to ask a real person in the next hour, with the answer that means go and the answer that means stop.
