# Runbook: Dinghy iMessage contact-card photo (vCard PHOTO fix)

## Root cause

`nativeContactCard()` (from `@spectrum-ts/imessage`, called in
`src/spectrum/index.ts`) does **not** build a vCard in code. It fires
`chats.shareContactInfo(chatGuid)` on the remote Mac, which shares the
**local macOS account's native contact card** — "My Card" in the
Contacts app of the machine running the Spectrum process (the Mac mini).
The name + photo the recipient sees therefore come from that machine's
Contacts "My Card", and no code change can set them.

## Fix (do this on the Mac mini that runs `src/spectrum/index.ts`)

1. Download the hosted avatar (the little-ship Photon image, e.g.
   `https://getdinghy.sh/logo.png` — same file as `public/logo.png`).
2. Open **Contacts** on the Mac mini.
3. Menu **Card → Go to My Card** (⌘1). If no My Card exists, create it
   (Card → Add My Card) with name `Dinghy`.
4. Click **Edit**, hover the photo circle → **Choose…** → select the
   downloaded little-ship image, adjust crop, **Save**.
5. Confirm the card is marked as **My Card** (shows "me" / bold).

## Why this survives iPhone save/import

`chats.shareContactInfo` sends the account's native contact card as a
real iMessage contact share. When the recipient taps **Create New
Contact**, macOS/iOS include the shared name and photo in the vCard
exchange — a photo shared this way is saved with the contact. (This is
exactly why the previous card saved *without* a photo: the Mac mini's
My Card had no photo set.)

## Verification (needs the iPhone)

1. From the iPhone, message the Dinghy line (+1 628 264-7754) and send
   `contact card` to trigger the on-demand share.
2. Tap the received card → **Create New Contact** → save.
3. Open the saved contact: the little-ship avatar must appear as the
   contact photo. If Messages shows only the name, re-send the card
   after redoing step 4 above (the share reflects the card at send time).
4. Screenshot the saved contact for the PR checklist.

## Not a code change

No patch to `@spectrum-ts/imessage` is needed (and none is possible —
the SDK exposes no vCard-builder API; it delegates to the OS contact
share). Upstreaming a custom-vCard content type would be a feature
request to Photon, not a fix for this bug.
