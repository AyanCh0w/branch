# ChatGPT sync on Mac

The Branch menu bar app can send new replies from one selected ChatGPT desktop conversation to one local Branch board. Updates appear on a conversation card in **Context**. The app reads the selected chat through macOS Accessibility and sends plain text replies after it sees streaming finish.

Build locally with Swift 6.2 or later:

```sh
cd desktop
swift test
sh build-probe.sh
open 'build/Branch Desktop Probe.app'
```

1. Run Branch with local Supabase on `http://localhost:4390/app`. Sign in and create a board with edit access. Follow the [local setup guide](../supabase/README.md#isolated-chatgpt-sync-development).
2. Pop out a regular ChatGPT chat with a completed reply. Open **Branch → ChatGPT Sync**, enable Accessibility, choose **Find ChatGPT windows**, and select the chat. Click **Sync selected chat**.
3. If the desktop window does not expose a chat URL, use **Copy pairing prompt** and send it once in that chat. When Branch opens the board picker, select a board and approve it.
4. Wait for **Syncing** before sending another message. After the first save, **Open Context card** opens the saved replies. Use **Stop syncing** from the app or **Disconnect ChatGPT chats** on the board to revoke access.

Each pairing starts with the existing chat history as a baseline. The app stops if the window changes, the chat becomes unreadable, or it cannot confirm a streaming cycle. Keep the chat window open while syncing. Pending replies and the scoped write key live in memory. The pairing expires within eight hours and needs to be renewed after quitting. Chrome and Mac connections each have their own conversation card.

## Desktop Sync Probe

Open **Branch → Desktop Sync Probe** to check whether a ChatGPT build exposes reply text and a reliable streaming signal. The diagnostic reads one selected window and copies only yes-or-no flags when you click **Copy results**.

1. On a Branch board, open **Account → Connect an agent → ChatGPT** and click **Copy baseline prompt**. The probe also has a copy button for the same prompt. Paste and send it in a new regular **Chat** in the ChatGPT macOS app. Wait for the reply, then pop that chat out into its own window.
2. In the probe, click **Request Accessibility Access…** and enable **Branch Desktop Probe** under **System Settings → Privacy & Security → Accessibility**. Click **Find ChatGPT windows**, select the test window, and click **Watch selected window**.
3. When the probe finds the baseline, click **Copy streaming prompt** and send it in the same ChatGPT window. Leave that window open until the probe reports a result. Click **Copy results** to share the diagnostic flags.

A pass requires an idle baseline, a new reply with both markers, and a stop control that appeared during the reply and then disappeared. The probe checks the same window, title, and chat identity if the app exposes it. A timeout is inconclusive. It can mean the app did not expose a control or reply text in the expected form. The report distinguishes those cases. For a fresh run, start a new chat and reopen the probe to generate new streaming markers. Remove its Accessibility access from System Settings when you are done testing.
