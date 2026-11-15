# ChatGPT sync on Mac

Branch for Mac sends new replies from one selected ChatGPT desktop conversation to one local Branch board. Updates appear on a conversation card in **Context**. The app reads the selected chat through macOS Accessibility and sends plain text replies after it sees streaming finish.

Build locally with Swift 6.2 or later and an Apple Development signing identity in your Keychain. List available identities with `security find-identity -v -p codesigning`. Configure the certificate name or fingerprint once per checkout.

```sh
git config --local branch.desktopSigningIdentity '<Apple Development identity>'
cd desktop
swift test
sh build-probe.sh
open 'build/Branch for Mac.app'
```

Keep using the same signing identity across builds so macOS can recognize updates. `BRANCH_CODESIGN_IDENTITY` overrides the checkout setting. Without an identity, the script builds the separate ad hoc **Branch Desktop Probe** for diagnostics. Use one consistent Developer ID Application identity and notarize the signed app before distributing it to users.

1. Run Branch with local Supabase on `http://localhost:4390/app`. Sign in and create a board with edit access. Follow the [local setup guide](../supabase/README.md#isolated-chatgpt-sync-development).
2. Open the ChatGPT conversation you want to sync, then open **Branch → ChatGPT Sync**. On first use, click **Allow Accessibility…** and approve **Branch for Mac** in the macOS prompt to load the window list. On later uses, click **Find ChatGPT windows**. Branch preselects the conversation when it finds one window. Confirm the selection with **Connect chat**.
3. If Branch needs a test reply to verify the conversation, click **Copy pairing prompt** and send it in that chat. When Branch opens the board picker, select a board and approve it.
4. Wait for **Syncing** before sending another message. After the first save, **Open in Branch** opens the saved replies. Use **Stop syncing** from the app or **Disconnect ChatGPT chats** on the board to revoke access.

Each pairing starts with the existing chat history as a baseline. The app stops if the window changes, the chat becomes unreadable, or it cannot confirm a streaming cycle. Keep the chat window open while syncing. Pending replies and the scoped write key live in memory. The pairing expires within eight hours and needs to be renewed after quitting. Chrome and Mac connections each have their own conversation card.

## Desktop Sync Probe

Open **Branch → Desktop Sync Probe** or click **Check window compatibility** after a failed setup to check whether a ChatGPT build exposes reply text and a reliable streaming signal. The diagnostic reads one selected window and copies only yes-or-no flags when you click **Copy results**.

1. On a Branch board, open **Account → Connect an agent → ChatGPT** and click **Copy baseline prompt**. The probe also has a copy button for the same prompt. Paste and send it in a new regular **Chat** in the ChatGPT macOS app. Wait for the reply, then pop that chat out into its own window.
2. In the probe, click **Request Accessibility Access…** if prompted, and allow the app under **System Settings → Privacy & Security → Accessibility**. Click **Find ChatGPT windows**, select the test window, and click **Watch selected window**.
3. When the probe finds the baseline, click **Copy streaming prompt** and send it in the same ChatGPT window. Leave that window open until the probe reports a result. Click **Copy results** to share the diagnostic flags.

A pass requires an idle baseline, a new reply with both markers, and a stop control that appeared during the reply and then disappeared. The report also indicates whether automatic sync recognized the baseline as a completed assistant reply. The probe checks the same window, title, and chat identity if the app exposes it. A timeout is inconclusive. It can mean the app did not expose a control or reply text in the expected form. The report distinguishes those cases. For a fresh run, start a new chat and reopen the probe to generate new streaming markers. Remove its Accessibility access from System Settings when you are done testing.
