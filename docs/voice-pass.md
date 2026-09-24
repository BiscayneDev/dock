# Dinghy voice pass

Every user-facing string Dinghy produces, rewritten in one voice: sentence case, direct, warm, honest. Dry humor only when it's earned. Nautical theme kept, but light. No all-lowercase, no cutesy lines.

## Emails

### Beta invite (src/lib/email/waitlist-invite.ts)

| | Before | After |
|---|---|---|
| Subject | lowercase "you're in" subject | You're in the Dinghy beta |
| Body | lowercase, "i'll", "seat on the boat" | Hey {First},<br>You're in. Your personal Dinghy line is {their number} - text it from the phone you signed up with and you're talking to me.<br>Tap here from your phone to start: [Text Dinghy]<br>No code, no setup. See you on the water.<br>- Dinghy |
| Prefilled text | hey dinghy, it's {first} | Hey Dinghy, it's {First} |

### Waitlist confirmation (src/lib/email/waitlist-confirmation.ts)

| | Before | After |
|---|---|---|
| Subject | you're on the dinghy waitlist | You're on the Dinghy waitlist |
| Body | hey {first} - you're on the list.<br>when a seat opens, i'll email you my number and a link that opens a text to me. one tap and we're talking.<br>nothing to do until then.<br>- dinghy | Hey {First},<br>You're on the list. When a spot opens, you'll get an email with your personal Dinghy line and a link to start texting.<br>Nothing to do until then.<br>- Dinghy |

## Persona and opener (src/lib/spectrum/dinghy.ts, src/spectrum/index.ts)

| Before | After |
|---|---|
| You are Dinghy, a personal AI first mate that lives in iMessage. | You are Dinghy, a personal AI assistant people reach over iMessage. |
| You're direct, concise, and helpful. You don't waste words on pleasantries. | You're direct, warm, concise and honest. You don't waste words on pleasantries or filler. |
| Write like a text: short, lowercase is fine, no markdown headings. | Write like a good text from a sharp, trusted assistant: short, plain words, normal sentence case and punctuation, no markdown headings. Never write in all lowercase, never use cutesy or overly familiar lines (no "i live in your texts", no pet names), and keep emoji rare. Dry humor only when it is earned. A light nautical touch is fine once in a while - never forced. |
| Day-1 opener asks: "what's eating your time this week?" | "What's taking up most of your time this week?" |
| Tool notes (computer, browse) in lowercase | Same content, sentence case |

## Beta gate (src/lib/spectrum/beta-gate.ts)

| Before | After |
|---|---|
| hey - dinghy's in private beta right now. if you have an invite code, text it here. no code yet? join the waitlist at getdinghy.sh | Hi, this is Dinghy. We're in private beta right now. If you have an invite code, text it here. No code yet? Join the waitlist at getdinghy.sh. |
| that code didn't work - double-check it, or join the waitlist at getdinghy.sh | That code didn't work. Double-check it, or join the waitlist at getdinghy.sh. |
| you're in - welcome to dinghy. save the contact card below so i show up as Dinghy, then text me whatever you need. | You're in - welcome to Dinghy. Save the contact card below so I show up as Dinghy, then text me whatever you need. |

## Welcome text for invited users (src/lib/spectrum/waitlist-invites.ts)

| Before | After |
|---|---|
| ahoy adam - it's dinghy. you're aboard. save this number and text me whatever you need. | Hi Adam, it's Dinghy. You're in the beta. Save this number and text me whatever you need. |

Owner-only invite results ("texted 2: ...", "no one waiting on the list right now.") are also in sentence case.

## Onboarding questions (src/lib/spectrum/interview.ts)

| Before | After |
|---|---|
| also - what should i call you? first name works. | Also, what should I call you? First name works. |
| one more thing, then i'm done with the questions - what should your mornings look like? | One more, then I'm done with questions: what should your mornings look like? |

## Errors and fallbacks

| Where | Before | After |
|---|---|---|
| rate-limit.ts | you're sending a lot at once - give me a few minutes and try again. | That's a lot at once. Give me a few minutes, then try again. |
| allowance.ts | that's today's allowance used up - i'm back at midnight your time. | You've used today's allowance. I'm back at midnight your time. |
| handler.ts | that didn't go through - try again in a moment. | That didn't go through. Try again in a moment. |
| handler.ts | couldn't read that attachment - try sending it again in a moment. | Couldn't read that attachment. Try sending it again in a moment. |
| handler.ts | couldn't send those invites - try again in a moment. | Couldn't send those invites. Try again in a moment. |
| handler.ts | couldn't mint an invite - try again in a moment. | Couldn't make an invite code. Try again in a moment. |
| handler.ts | couldn't start the connect flow - try again in a moment. | Couldn't start the connection. Try again in a moment. |
| handler.ts | couldn't pull your memories up right now - try again in a moment. | Couldn't pull up what I remember right now. Try again in a moment. |
| handler.ts | ok, scrapped it. | OK, scrapped it. |
| handler.ts | got it. I'll use that for your morning weather. | Got it. I'll use that for your morning weather. |
| handler.ts | email + calendar aren't connected yet - tap below to connect google and i'll take it from there: | Your email and calendar aren't connected yet. Tap below to connect Google and I'll take it from there: |
| handler.ts | whoop: | Connect WHOOP here: |
| handler.ts (owner) | invite code: X (...). they text it to this number. | Invite code: X (...). They text it to this number. |

## Connections (src/lib/spectrum/connect-lines.ts)

| Before | After |
|---|---|
| you're connected — gmail + calendar are in ✓ | You're connected. Gmail and Calendar are in. |
| you're connected — gmail + calendar for {email} ✓ | You're connected. Gmail and Calendar are in for {email}. |
| that connected {email} again - the account you already had, so i still see just one... | That connected {email} again - the account you already had, so I still see just one... |

## Memory commands (src/lib/spectrum/memory-commands.ts)

| Before | After |
|---|---|
| nothing saved about you yet. tell me things and i'll remember - say 'forget x' anytime and i'll drop it. | Nothing saved about you yet. Tell me things and I'll remember them. Say 'forget x' any time and I'll drop it. |
| here's what i remember about you: ... say 'forget x' to drop one, 'forget everything' to wipe it all. | Here's what I remember about you: ... Say 'forget x' to drop one, or 'forget everything' to wipe it all. |
| that clears everything i remember about you... reply YES to wipe it all - anything else cancels. | That clears everything I remember about you... Reply YES to wipe it all - anything else cancels. |
| done - wiped everything i remembered (N things). fresh start. | Done. I wiped everything I remembered (N things). Fresh start. |
| nothing was saved anyway, but the slate is clean. | Nothing was saved, so the slate is already clean. |
| ok, cancelled - i kept everything. | OK, cancelled. I kept everything. |

## Morning briefing (src/lib/spectrum/briefing.ts)

| Before | After |
|---|---|
| reply mute mornings to stop these | Reply "mute mornings" to stop these. |
| ok, mornings muted. say "unmute mornings" any time to bring them back. | Morning briefings are off. Say "unmute mornings" any time to turn them back on. |
| mornings are back on — expect the next briefing around 8. | Morning briefings are back on. The next one comes around 8. |
| no account is connected to this chat, so there's no briefing to mute. | No account is connected to this chat, so there's no briefing to mute. |

## Confirmations before acting (src/lib/spectrum/actions.ts)

| Before | After |
|---|---|
| send this email? ... to: / subject: ... reply y to send, n to cancel | Send this email? ... To: / Subject: ... Reply Y to send, N to cancel. |
| send this reply? from: ... | Send this reply? From: ... |
| disconnect {email} from dinghy? i'll stop reading... | Disconnect {email} from Dinghy? I'll stop reading... |
| create this event and send invites? on: / invites: | Create this event and send invites? On: / Invites: |
| browse {site} for you while logged in? reply y to run it | Browse {site} for you while logged in? Reply Y to run it, N to cancel. |
| sent to X. / reply sent. / event created and invites sent. / browsing done. | Sent to X. / Reply sent. / Event created and invites sent. / Browsing done. |
| that draft expired - ask me again and i'll redo it. | That draft expired. Ask me again and I'll redo it. |

## Contact card (src/lib/spectrum/contact-card.ts)

No change. It carries the name "Dinghy", the person's own line and the site URL.

## Landing page, sign-in, share cards (src/app)

| Where | Before | After |
|---|---|---|
| Page title / share cards | Dinghy · your first mate lives in your texts | Dinghy · Your first mate, one text away |
| Meta description | dinghy is a first mate that lives in imessage. you text it like a person. it does the work. | Dinghy is a personal AI assistant you reach over iMessage. Text it the way you'd text a person. It does the work. |
| Headline | your first mate lives in *your texts* | Your first mate, *one text away* |
| Hero line | dinghy is a first mate that lives in imessage. you text it like a person. **it does the work.** | Dinghy is a personal AI assistant you reach over iMessage. Text it the way you'd text a person. **It does the work.** |
| Buttons / nav | join the beta, sign in, dinghy | Join the beta, Sign in, Dinghy |
| How it's built | shipyard picks the model, dinghy runs the agent, paybox holds the keys. you just text. | Shipyard picks the model, Dinghy runs the agent, Paybox holds the keys. You just text. |
| Waitlist panel | get a seat on the boat / dinghy is in private beta. leave your email and i'll send your invite when a seat opens. | Get a seat on the boat / Dinghy is in private beta. Leave your email and we'll send your invite when a spot opens. |
| Form | your name / mobile (optional) / @handle on x (optional) / join the waitlist | Your name / Mobile (optional) / X handle (optional) / Join the waitlist |
| Form note | your invite comes by email - then you just text dinghy. no spam. | Your invite comes by email. After that, you just text Dinghy. No spam. |
| Form success | you're on the list. watch your inbox for your seat. | You're on the list. Watch your inbox for your invite. |
| Footer | dinghy · a shipyard product · privacy · terms · shipyard | Dinghy · a Shipyard product · Privacy · Terms · Shipyard |
| Sign-in | sign in to dinghy / phone number / check your texts / sign-in code / use a different number / send a new code / get on the waitlist | Same words, sentence case |

The mobile field stays optional.
