# Demo runbook

## 1. Roles

| Role | Person | During the demo |
|---|---|---|
| The speaker | Ralf | Speaks, and answers the judges' questions |
| The owner | Nadim | At the laptop. Switches between the windows, reads the handoff in Slack and presses "Approve fix". The button works only for the owner's Slack account |
| The three reporters | Roger, Diana, Kata | Each sends one report from a phone at 0:20, from a draft saved beforehand |
| The timekeeper | Kata | Keeps the time and starts the backup recording if the network fails |

Before the team walks on:

1. The owner runs the high-severity case: three reports about a wrong transfer amount.
2. The owner keeps its finished thread open in a second Slack window.

The three reports. Each reporter saves theirs as a draft in `#support` on their phone.

| Reporter | Report text |
|---|---|
| Reporter 1 | Customer says the picture of her card keeps blinking on the card page, she is on her phone. |
| Reporter 2 | Got one too: card image flashes on and off every second on the card page, Chrome on a laptop. |
| Reporter 3 | Third customer today with the card picture flickering on the card page, he sent a screen recording. |

## 2. The screen

What is open on the demo laptop before we walk on:

1. Left half of the screen: Slack, channel `#support`, in the Slack account of the owner. Zoom 150%.
2. Right half: one browser window with three tabs in this order. Zoom 150%.
   1. The card page at `[CARD PAGE ADDRESS]`.
   2. Prometheus's query page with two graphs: the tool's own query (5xx on `/card` in the last hour; "Empty query result" means there are none) and, under it, `/card` traffic by status, so the jury sees the 200s and no 5xx. Open it with:
      `http://localhost:9090/query?g0.expr=sum(rate(http_requests_total%7Bpath%3D%22%2Fcard%22%2Cstatus%3D~%225..%22%7D%5B1h%5D))&g0.tab=graph&g0.range_input=15m&g1.expr=sum%20by%20(status)%20(rate(http_requests_total%7Bpath%3D%22%2Fcard%22%7D%5B1m%5D))&g1.tab=graph&g1.range_input=15m`
   3. The card app's repository at `[REPOSITORY ADDRESS]`.
3. A second Slack window, behind the first, on the finished high-severity thread. Zoom 150%.
4. A small terminal at the bottom of the screen, showing the tool's log. Font large enough to read from the back of the room.

New on 14 November, both in the first Slack thread, so nothing new has to be opened:

- While the tool investigates, the thread shows `Reproduced in a browser: the card picture was replaced 5 times in 5 seconds.` The wrong-amount thread names the row: `row 4: stored 2,040.00, shown 2,40.00 EUR`.
- After the owner presses "Approve fix", the thread shows `Deployed. Checked the card page in a browser: the card picture was not replaced in 5 seconds (before the fix: replaced 5 times).` It came 14.5 to 17.9 s after the press in 9 runs on the build PC. Keep the first thread in view until it arrives, then switch to the card page.
- The card page has a new look (green, large rounded cards). The name is still Demo Bank and both planted problems are unchanged.

The 150% zoom is a starting value, not a measurement. Check it from the back of the room at the 08:15 run and write the new value here.

## 3. The three minutes

| Time | The speaker | The owner | The three reporters | The timekeeper |
|---|---|---|---|---|
| 0:00 to 0:20 | Points at the flickering card page and at the empty Prometheus graph | Has the card page tab and the Prometheus tab side by side. Touches nothing | Hold their phones with the draft open in `#support` | Starts the stopwatch at the first word |
| 0:20 to 0:45 | Says the reports are coming in | Brings Slack `#support` to the front | Each sends the report already saved as a draft, one after another, about three seconds apart | Signals the first reporter to send at 0:20 |
| 0:45 to 1:10 | Reads the tool's thread aloud as it fills in | Keeps the first thread in view and scrolls with it | Nothing | Watches for the tool's first post. Signals the owner if nothing comes by 15 seconds after the third report |
| 1:10 to 2:05 | Explains the high-severity case while the tool works | Brings the second Slack window to the front and scrolls to the handoff | Nothing | Watches the terminal for the fix. Signals the speaker at 60 seconds with no fix |
| 2:05 to 2:35 | Reads the handoff, then says "approve" | Returns to the first thread and presses "Approve fix" when the speaker says "approve" | Nothing | Starts counting the seconds from the approval |
| 2:35 to 3:00 | Points at the card page holding still | Switches to the card page tab and reloads it | Nothing | Signals the speaker at 2:50 to finish |

## 4. When a step fails

The 60, 20 and 15 seconds are the plan's limits, not measurements.

| What we see | What we do | What the speaker says |
|---|---|---|
| No fix after 60 seconds | Nothing. The tool opens a pull request that undoes the change | "When the smallest fix is not clear, the tool proposes undoing the commit, and the owner still decides." |
| The tool judges the flicker high severity and posts a handoff with no fix | Show the commit and the lines it named. End there | "The tool was not sure, so it left the code alone and handed the team the commit and the lines." |
| "Approve fix" does nothing | The owner merges the pull request on GitHub from the link in the handoff | "The button is a shortcut. The same pull request is one click away on GitHub." |
| The page has not redeployed 20 seconds after the approval | End on the merged pull request | "The fix is merged, and the app picks it up on its next restart." |
| The tool posts nothing 15 seconds after the third report | A reporter posts a fourth report. If still nothing, the timekeeper switches to the recording | "One more customer just wrote in." If the recording plays: "Here is the same run from this morning." |
| The venue network drops | The owner switches the laptop to a phone hotspot. If that takes more than 20 seconds, the timekeeper plays the recording | "The venue network dropped, so here is the same run recorded this morning." |
| Slack or GitHub asks someone to log in | The owner moves to the second laptop, which is logged in to both | "We switch to our second laptop, the run is the same." |
| The picture does not flicker at the start | The owner reloads the page once. If it still holds, the owner runs `[RESET COMMAND]` | "One moment, we put the bug back in." |

## 5. Checklist: the evening before

- [ ] Both laptops are logged in to Slack and GitHub as the owner. The second laptop repeats the same two accounts.
- [ ] All five phones are in the Slack workspace "Innovative Bug Fixer", signed in, and able to post in `#support`.
- [ ] The three reporters have each saved their report as a draft in `#support` on their phone. The texts are in section 1.
- [ ] Chargers for both laptops are packed.
- [ ] An HDMI adapter and a USB-C adapter are packed.
- [ ] The backup recording is on the desktop of both laptops and on one phone. Tick this box after 09:30 on the day.
- [ ] The answers to questions 5 to 7 of #8 are written into this runbook, if there are any.

## 6. Checklist: 30 minutes before

- [ ] Run `[START COMMAND]`.
- [ ] Run `[RESET COMMAND]`.
- [ ] Run the flicker case once, from the three reports to the fixed card page.
- [ ] Run the high-severity case and leave its finished thread open in the second Slack window.
- [ ] Run `[RESET COMMAND]` again.
- [ ] Turn notifications off on the demo laptop. Windows 11: Settings, System, Notifications, "Do not disturb".
- [ ] Set the demo laptop screen not to sleep.
- [ ] Put every phone on the same network as agreed and on silent.
- [ ] Check the three drafts are still in `#support` on the three phones.
- [ ] Arrange the windows as section 2 says.

## 7. Rehearsals

| Item | Value |
|---|---|
| Demo time | `[DEMO TIME]` |
| Seconds until the handoff with the pull request link, from the hand-off | `[SECONDS: FIX]` |
| Seconds from approval to the fixed page, from the hand-off | `[SECONDS: REDEPLOY]` |
| Target | Five runs under 3:00 |

| Run | Total time | Seconds until the handoff with the pull request link | Seconds from approval to the fixed page | What went wrong |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## 8. The backup recording

1. Set the demo laptop display to 1920 by 1080.
2. Open OBS Studio.
3. Add a Display Capture source for the whole demo laptop screen.
4. Set the canvas resolution to 1920 by 1080.
5. Set the output resolution to 1920 by 1080.
6. Set the frame rate to 30 frames a second.
7. Set the recording format to MP4.
8. Set the recording path to the desktop and the file name to `demo-bank-backup.mp4`.
9. Start recording before the full run begins.
10. Stop recording after the card page holds still.
11. Copy `demo-bank-backup.mp4` to the desktop of the second laptop and to one phone.

| Item | Value |
|---|---|
| File name | `demo-bank-backup.mp4` |
| Kept on | The desktop of both laptops and one phone |
| Started on stage by | The timekeeper |
| How it is ready | The file is open in a video player, paused on the first frame, before we walk on |
| Status | Untested until the recording is made at 09:30 |

## 9. Placeholders for the core team

Each placeholder is replaced from the hand-off at 07:30.

| Placeholder | Used in | What goes there |
|---|---|---|
| `[START COMMAND]` | Section 6 | The command that starts the tool, the card app and Prometheus |
| `[RESET COMMAND]` | Sections 4 and 6 | The command that puts the flicker back and clears the last run |
| `[CARD PAGE ADDRESS]` | Section 2 | The address of the card page on the demo laptop |
| `[REPOSITORY ADDRESS]` | Section 2 | The address of the card app's repository on GitHub |
| `[SECONDS: FIX]` | Section 7 | Measured seconds from the third report to the handoff with the pull request link |
| `[SECONDS: REDEPLOY]` | Section 7 | Measured seconds from "Approve fix" to the fixed card page |
| `[DEMO TIME]` | Section 7 | The confirmed demo time, Tallinn time |
