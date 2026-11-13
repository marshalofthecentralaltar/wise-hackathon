# Wise hackathon: mentor conversation transcript

Source: speech-to-text of a live conversation at the Wise hackathon, pasted on 2026-11-13. The source had no speaker labels.

How to read this file:

- **Transcript** keeps every word of the source in order. Only turn breaks and speaker labels were added.
- Speaker labels are inferred from context (who asks, who answers, who is addressed by name). Treat them as probable, not certain.
  - **Team** = the hackathon participants (more than one person may be speaking under this label).
  - **Wise mentor** = the unnamed Wise employee doing most of the explaining.
  - **Oleg** = Wise engineer, addressed by name; mentor of last year's winning team.
- `[?: ...]` marks a spot where the speech-to-text is probably wrong or the meaning is unclear. The original words are left in place before the mark.
- **Raw source** at the bottom is the paste exactly as received.

## Transcript

**Team:** What dashboards are you using for engineering?

**Wise mentor:** So Grafana is like a suite of tools. So it has lots of different names that are very Marvel related. Yeah. Logs are in Loki. Then all the metric stuff. Where does that? How does that work, Oleg?

**Oleg:** In Prometheus.

**Wise mentor:** Yeah. In Prometheus.

**Oleg:** Yeah, so it's a type of database for metrics, and Grafana is more like a UI to pull the data from there and graph on charts.

**Wise mentor:** Yeah. I can show what it looks like. I think there's no way to sort it. [?: speaker and meaning unclear]

**Team:** Okay, so Prometheus is the brain, and then Grafana maps it out basically.

**Oleg:** Kind of, yeah.

**Wise mentor:** Yeah. Okay. Yeah, it's hard to tell. They've got lots of. It's like a suite of things. Like most medium to large companies are using Grafana or Datadog. These are the kind of big players. Are you familiar with them?

**Team:** Yeah, Grafana we're using also. Yeah, but the customer service. Do you have any idea? Customer service dashboards?

**Wise mentor:** I don't know about dashboards, but they were using. Is it Twilio, Oleg? Is that what we're using customer service?

**Oleg:** I think Zendesk.

**Wise mentor:** Pardon, Zendesk. You think?

**Oleg:** Zendesk, yeah. No, I'm not sure if it's public or not, but.

**Wise mentor:** Okay. Either way, they're such big companies. They'll have lots of integrations. Mm-hmm. But I don't know 100%. What the tools are at that end. I have done the customer service day and been on the phones, and I swear we were using Twilio to do the phones. It's quite scary.

**Team:** But if you were to implement this logic that we're talking about technically, not like code-wise, but product-wise, Grafana uses these thresholds, blah, blah, blah, alerting. Customer service gets the tickets. I don't know, where do they even get the tickets? Slack or?

**Wise mentor:** Yeah, I think it was a Slack channel, right? So customer service will try and tell if someone's told them there's a problem, they would then go into Slack to try and find out who can help them.

**Team:** Okay.

**Wise mentor:** Either something big. Come in. /incident on Slack. Yeah. [?: likely "if something big comes in, /incident on Slack"]

**Wise mentor:** Yeah. So that's what the farm now [?: likely "Grafana"] looks like. It's just it looks terrifying.

**Team:** Yeah. It does look a bit terrifying. Some graphs and stuff, yeah.

**Oleg:** Yeah, but okay. Yeah, it's and you can set up alerts on different types of metrics and basically.

**Wise mentor:** Yeah. So this is how would most teams. This is why I'm like it wouldn't really help Sev once [?: likely "Sev 1s"] because most people would get these would light up, and we have boards around the office, like TVs around the office. That doesn't display Grafana. Let's play dashboards, [?: likely "that display Grafana, display dashboards"] dashboards and stuff, so we can see if everything goes red or not.

**Team:** Okay.

**Wise mentor:** So that's why I think it's all about the nitpicks. It's all about all those small wins edge cases that are taking time or never being fixed.

**Team:** Yeah.

**Wise mentor:** Because you can imagine there was when we first took these AI tools on, I was then running workshops with all the different teams to try and get them on, and they all started fixing things that they were then saying, "Oh, this has been there for ages," and they were going fix it with these tools. You are basically taking that time off the table, like all these little things that are just going missed, never executed, blah, blah, blah.

**Team:** So not just we shouldn't just focus on anything that comes in through your Slack or support, but just why not just go through all the GitHub issues or issues that you guys have.

**Wise mentor:** You would have a system running that's got different connectors. One would be watching Slack. One would be watching whatever Zendesk or Twilio API, so it'll be watching them, and then it'll be doing a first step, which is understanding the problem.

**Team:** Yeah.

**Wise mentor:** It becomes a flow diagram, true or false. And then once you just think there might be, you then talk to Grafana, Prometheus APIs, and be like, is there anything you're noticing here? Like for front end things, we use Rollbar. And then because you're going to need to see. Like, not everyone would log their front-end problems in the same way as they log their back-end problems.

**Team:** Okay.

**Wise mentor:** And you were just trying to work out, can you see an error? Can you see a problem? Then you could either go to a developer verification, because if it's I can't see a problem, but someone's saying their card pictures are flickering, because that was one they fixed with the... Claude Code.

**Team:** Okay.

**Wise mentor:** Because if they can't see a problem, then it's more that you want a developer to be like, "Oh yeah, that is go, go, take my problems away." So it's just going to be it's like a flow diagram.

**Team:** Yeah.

**Wise mentor:** There's going to be many different decision points and stuff to eventually get to somewhere that would try and do an agentic fix or a rollback or thing. What you would actually then hammer out with Claude Code as a kind of example of this thing going round.

**Team:** Sorry, to interrupt you. Okay. Since you said only 2% of the time you need to actually do a rollback, in what scenario is a rollback actually necessary then?

**Wise mentor:** So if someone deploys a change, we have something called automated canary analysis.

**Team:** Okay.

**Wise mentor:** That will then start slowly rolling out a change over percentages of traffic. So it'll hit 1% of users.

**Team:** Okay.

**Wise mentor:** And it'll hit 5, then 10. And as soon as any of the metrics you've set up or the base ones in there go wrong, it will automatically roll it back.

**Team:** Okay.

**Wise mentor:** The other one is you can go into the system and say, go to the previous image that was deployed. And it will go back as well. I don't know how many different things, because of course, as an engineer, you can revert a commit, and then deploy that. That probably is not seen as a rollback. It is forward failures, [?: likely "fail forward" / "forward fixes"] but we're probably not tracking that in a smart way to see that happen. So it's very hard to pick up that you've reverted a commit.

**Team:** Okay. So there's a lot of that's like a big architecture. I don't know how we're going to prototype it.

**Wise mentor:** Well, I wonder. What I'd be thinking is how many just mock fake endpoints you could make. You could spin up fake Twilio or fake Zendesk on this port, then fake them all off, and then what you want to do is have a wise-looking [?: "Wise-looking", styled like Wise] customer service portal that someone could type in, and it would ping, and it would work itself around, pinging off the fake servers.

**Team:** We could for sure even show it how Slack messenger coming in for a certain problem and how the workflow goes from there. It's very doable for a mock. Right?

**Wise mentor:** My main reason for inviting you right now is so much more speed than last year. Because last year it was still very chatbot, copy and paste. It was punch it into ChatGPT and paste it out. Now it can write the files for you.

**Team:** I remember starting off as well with asking ChatGPT for functions and then pasting them in, and now Claude Code just runs on my own. I can't remember how was the pitching. Can we show a video and do the prototype as well?

**Wise mentor:** The people that won last time showed a video, and I wasn't keen on that. I was furious. I'm not a judge. I'm too emotional to be a judge. They showed the video just because they had it on the phone, and basically it would have been not possible. They could have brought in a video camera. Oleg was the mentor for the winning team. They could have brought in a video camera. Held it over the phone.

**Oleg:** They were smart enough, yes.

**Wise mentor:** I think anything you demo for real is always going to look better, but record it as well. I think if you showed portion not, [?: unclear, possibly "a portion or not"] it wouldn't be a problem. I think.

**Team:** I'm thinking this is the kind of thing that is more easily demonstrated on a video, not switching from 3 or 4 different pages to show everything.

**Wise mentor:** But that's why I wondered if you had all the 4 odd terminals running with the mocks and deliberately verbose logging in them. So when they're hit, it's detected, and then you had one fake web UI or something that you could enter the customer problem in. And then all you really you want to show is this is the PR it made to fix the problem. And so and I think that would look good. And then if you have that with, this is what we're trying to say. This is the restriction we're trying to do. If there's 20,000 PRs, there's all this code movement, and it's not easy to track or understand what problem kicked off. And then I said, I think you explicitly Wise has strong enough monitoring that this won't get the biggest severities. It's more to get these things that are just being missed or not done, to make a better product, to make it easier for customer service, and to make engineers not even involved unless they have to be. And do a dance or something. To catch attention.

**Team:** All right, tell a story. Previously told us about the contact list or the catalog of the different teams and the domains.

**Wise mentor:** And yeah, so we own that. Ilo's key for that. [?: unclear, possibly a person or tool name]

**Team:** Mm-hmm.

**Wise mentor:** So you have like slash accounts and then there's responsibilities for it. So if by the web addresses, we have like all of them are registered to a specific team. Like, but what I assume a team owns the whole page. I'm trying to think, we don't use it. I'm trying to think how the Wise toolkit Chrome extension works, where it points to the owner. It definitely looks at the DNS ref. Like it looks into the proxy that maps the URL to the backend.

**Oleg:** Yeah. Yeah. So basically, all the backend calls, they go through one proxy, and then it follows them to the right subservice. And basically, and we have all the mappings from proxy, from path to service, and from service to team.

**Team:** Okay. Right. I guess we'll brainstorm now.

**Wise mentor:** It's time to work, yeah. Good luck.

**Team:** After 3.5 hours, we have an idea, so...

## Facts stated

A digest of what was said, for quick lookup. Nothing here is verified beyond the conversation itself.

**Engineering monitoring at Wise**
- Grafana suite: logs in Loki, metrics in Prometheus, Grafana as the charting UI on top. Alerts can be set on metrics.
- Front-end errors go to Rollbar. Front-end and back-end problems are not logged the same way.
- TVs around the office show the dashboards, so large failures are seen quickly.

**Customer service tooling (unconfirmed)**
- Oleg thinks Zendesk. The mentor remembers Twilio for the phones. Neither was sure, and Oleg was not sure it is public.
- When a customer reports a problem, customer service goes to a Slack channel to find who can help. Big problems use `/incident` in Slack.

**The mentor's steer on the idea**
- Do not aim at the biggest severities: Wise's monitoring already catches those.
- Aim at nitpicks and small edge cases that take time or never get fixed.
- Suggested flow: connectors watch Slack and the Zendesk or Twilio API, a first step understands the problem, then the system asks Grafana, Prometheus and Rollbar whether an error is visible. Visible error leads towards an agentic fix or rollback. No visible error (example: card pictures flickering) goes to a developer for verification.
- The team added: also sweep existing GitHub issues, not only incoming Slack or support messages.

**Rollbacks**
- Automated canary analysis rolls a change out to 1%, then 5%, then 10% of traffic and rolls back automatically when a metric goes wrong.
- An engineer can also redeploy the previous image.
- Reverting a commit and redeploying is probably not tracked as a rollback, so it is hard to detect.
- The team quoted an earlier figure: a rollback is needed about 2% of the time.

**Prototype and pitch advice**
- Run fake Twilio, Zendesk and similar servers on local ports, about four terminals with deliberately verbose logging.
- One Wise-styled customer service portal where someone types the problem; the request visibly travels through the mocks.
- The thing to show at the end: the PR it made to fix the problem.
- Demo live because it looks better, and record it as well. Last year's winners showed a video.
- Pitch framing: with 20,000 PRs it is hard to trace which problem started a change; this catches what is missed, makes a better product, eases customer service, and involves engineers only when needed. Tell a story.

**Ownership mapping**
- Web addresses (paths such as `/accounts`) are registered to a specific team.
- All backend calls go through one proxy. Mappings exist from path to service and from service to team.
- The Wise toolkit Chrome extension points to the owner of a page.

## Raw source

What dashboards are you using for engineering? So Grafana is like a suite of tools. So it has lots of different names that are very Marvel related. Yeah. Logs are in Loki. Then all the metric stuff. Where does that? How does that work, Oleg? In Prometheus. Yeah. In Prometheus. Yeah, so it's a type of database for metrics, and Grafana is more like a UI to pull the data from there and graph on charts. Yeah. I can show what it looks like. I think there's no way to sort it. Okay, so Prometheus is the brain, and then Grafana maps it out basically. Kind of, yeah. Yeah. Okay. Yeah, it's hard to tell. They've got lots of. It's like a suite of things. Like most medium to large companies are using Grafana or Datadog. These are the kind of big players. Are you familiar with them? Yeah, Grafana we're using also. Yeah, but the customer service. Do you have any idea? Customer service dashboards? I don't know about dashboards, but they were using. Is it Twilio, Oleg? Is that what we're using customer service? I think Zendesk. Pardon, Zendesk. You think? Zendesk, yeah. No, I'm not sure if it's public or not, but. Okay. Either way, they're such big companies. They'll have lots of integrations. Mm-hmm. But I don't know 100%. What the tools are at that end. I have done the customer service day and been on the phones, and I swear we were using Twilio to do the phones. It's quite scary. But if you were to implement this logic that we're talking about technically, not like code-wise, but product-wise, Grafana uses these thresholds, blah, blah, blah, alerting. Customer service gets the tickets. I don't know, where do they even get the tickets? Slack or? Yeah, I think it was a Slack channel, right? So customer service will try and tell if someone's told them there's a problem, they would then go into Slack to try and find out who can help them. Okay. Either something big. Come in. /incident on Slack. Yeah. Yeah. So that's what the farm now looks like. It's just it looks terrifying. Yeah. It does look a bit terrifying. Some graphs and stuff, yeah. Yeah, but okay. Yeah, it's and you can set up alerts on different types of metrics and basically. Yeah. So this is how would most teams. This is why I'm like it wouldn't really help Sev once because most people would get these would light up, and we have boards around the office, like TVs around the office. That doesn't display Grafana. Let's play dashboards, dashboards and stuff, so we can see if everything goes red or not. Okay. So that's why I think it's all about the nitpicks. It's all about all those small wins edge cases that are taking time or never being fixed. Yeah. Because you can imagine there was when we first took these AI tools on, I was then running workshops with all the different teams to try and get them on, and they all started fixing things that they were then saying, "Oh, this has been there for ages," and they were going fix it with these tools. You are basically taking that time off the table, like all these little things that are just going missed, never executed, blah, blah, blah. So not just we shouldn't just focus on anything that comes in through your Slack or support, but just why not just go through all the GitHub issues or issues that you guys have. You would have a system running that's got different connectors. One would be watching Slack. One would be watching whatever Zendesk or Twilio API, so it'll be watching them, and then it'll be doing a first step, which is understanding the problem. Yeah. It becomes a flow diagram, true or false. And then once you just think there might be, you then talk to Grafana, Prometheus APIs, and be like, is there anything you're noticing here? Like for front end things, we use Rollbar. And then because you're going to need to see. Like, not everyone would log their front-end problems in the same way as they log their back-end problems. Okay. And you were just trying to work out, can you see an error? Can you see a problem? Then you could either go to a developer verification, because if it's I can't see a problem, but someone's saying their card pictures are flickering, because that was one they fixed with the... Claude Code. Okay. Because if they can't see a problem, then it's more that you want a developer to be like, "Oh yeah, that is go, go, take my problems away." So it's just going to be it's like a flow diagram. Yeah. There's going to be many different decision points and stuff to eventually get to somewhere that would try and do an agentic fix or a rollback or thing. What you would actually then hammer out with Claude Code as a kind of example of this thing going round. Sorry, to interrupt you. Okay. Since you said only 2% of the time you need to actually do a rollback, in what scenario is a rollback actually necessary then? So if someone deploys a change, we have something called automated canary analysis. Okay. That will then start slowly rolling out a change over percentages of traffic. So it'll hit 1% of users. Okay. And it'll hit 5, then 10. And as soon as any of the metrics you've set up or the base ones in there go wrong, it will automatically roll it back. Okay. The other one is you can go into the system and say, go to the previous image that was deployed. And it will go back as well. I don't know how many different things, because of course, as an engineer, you can revert a commit, and then deploy that. That probably is not seen as a rollback. It is forward failures, but we're probably not tracking that in a smart way to see that happen. So it's very hard to pick up that you've reverted a commit. Okay. So there's a lot of that's like a big architecture. I don't know how we're going to prototype it. Well, I wonder. What I'd be thinking is how many just mock fake endpoints you could make. You could spin up fake Twilio or fake Zendesk on this port, then fake them all off, and then what you want to do is have a wise-looking customer service portal that someone could type in, and it would ping, and it would work itself around, pinging off the fake servers. We could for sure even show it how Slack messenger coming in for a certain problem and how the workflow goes from there. It's very doable for a mock. Right? My main reason for inviting you right now is so much more speed than last year. Because last year it was still very chatbot, copy and paste. It was punch it into ChatGPT and paste it out. Now it can write the files for you. I remember starting off as well with asking ChatGPT for functions and then pasting them in, and now Claude Code just runs on my own. I can't remember how was the pitching. Can we show a video and do the prototype as well? The people that won last time showed a video, and I wasn't keen on that. I was furious. I'm not a judge. I'm too emotional to be a judge. They showed the video just because they had it on the phone, and basically it would have been not possible. They could have brought in a video camera. Oleg was the mentor for the winning team. They could have brought in a video camera. Held it over the phone. They were smart enough, yes. I think anything you demo for real is always going to look better, but record it as well. I think if you showed portion not, it wouldn't be a problem. I think. I'm thinking this is the kind of thing that is more easily demonstrated on a video, not switching from 3 or 4 different pages to show everything. But that's why I wondered if you had all the 4 odd terminals running with the mocks and deliberately verbose logging in them. So when they're hit, it's detected, and then you had one fake web UI or something that you could enter the customer problem in. And then all you really you want to show is this is the PR it made to fix the problem. And so and I think that would look good. And then if you have that with, this is what we're trying to say. This is the restriction we're trying to do. If there's 20,000 PRs, there's all this code movement, and it's not easy to track or understand what problem kicked off. And then I said, I think you explicitly Wise has strong enough monitoring that this won't get the biggest severities. It's more to get these things that are just being missed or not done, to make a better product, to make it easier for customer service, and to make engineers not even involved unless they have to be. And do a dance or something. To catch attention. All right, tell a story. Previously told us about the contact list or the catalog of the different teams and the domains. And yeah, so we own that. Ilo's key for that. Mm-hmm. So you have like slash accounts and then there's responsibilities for it. So if by the web addresses, we have like all of them are registered to a specific team. Like, but what I assume a team owns the whole page. I'm trying to think, we don't use it. I'm trying to think how the Wise toolkit Chrome extension works, where it points to the owner. It definitely looks at the DNS ref. Like it looks into the proxy that maps the URL to the backend. Yeah. Yeah. So basically, all the backend calls, they go through one proxy, and then it follows them to the right subservice. And basically, and we have all the mappings from proxy, from path to service, and from service to team. Okay. Right. I guess we'll brainstorm now. It's time to work, yeah. Good luck. After 3.5 hours, we have an idea, so...
