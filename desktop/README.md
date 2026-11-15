# Conversation sync on Mac

Branch for Mac sends new replies from a selected conversation in the ChatGPT desktop app to one Branch board on joinbranch.dev. Updates appear on a conversation card in **Context**.

Build locally with Swift 6.1 or later and an Apple Development signing identity in your Keychain. List available identities with `security find-identity -v -p codesigning`. Configure the certificate name or fingerprint once per checkout.

```sh
git config --local branch.desktopSigningIdentity '<Apple Development identity>'
cd desktop
swift test
sh build-probe.sh
open 'build/Branch for Mac.app'
```

Keep using the same signing identity across builds so macOS can recognize updates. `BRANCH_CODESIGN_IDENTITY` overrides the checkout setting. Without an identity, the script builds the separate ad hoc **Branch Desktop Probe** for diagnostics. Use one consistent Developer ID Application identity and notarize the signed app before distributing it to users.

1. Open a board at https://joinbranch.dev/app, then **Conversation sync → Connect a conversation**. The Mac app opens with that board already authorized. No local web server or copied key is needed. For a first install, follow the [employee setup page](https://joinbranch.dev/mac-setup.html).
2. Open a Chat, Work, or Codex conversation, then open **Branch → Conversation Sync**. On first use, allow Accessibility so Branch can list open windows. Choose the conversation and click **Connect conversation**.
3. When started from a board, Branch connects as soon as it can read the selected chat. When started from the menu bar without a board authorization, choose the destination board in the browser.
4. Wait for **Sync is on** in Branch for Mac before sending another message. After the first save, the app confirms the reply was saved and **Open in Branch** opens the saved replies. Use **Stop syncing** from the app or **Disconnect conversations** on the board to revoke access.

Each pairing uses existing history as a baseline. Branch checks the selected window through Accessibility first. When it can read the window but needs another way to capture replies, it tries to match a uniquely titled local conversation through the Codex App Server. Window-based capture pauses when you switch chats and resumes when Branch recognizes the paired conversation again. Local thread sync follows the paired ID when you switch chats and sends final replies from completed turns after pairing. Work conversations can sync when their window exposes readable completed replies or the conversation is available locally. Pending replies and the scoped write key live in memory. The pairing expires within eight hours and needs to be renewed after quitting.

## Release the employee installer

Sign Branch for Mac with the team’s Developer ID Application certificate, then package and notarize a disk image containing the app. See [Apple’s distribution guide](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution). Test the downloaded installer on a Mac independently of the development build.

Set `BRANCH_MAC_INSTALLER` to the notarized and stapled `.dmg` when building the website on a Mac with Xcode. The public build checks the staple, publishes the file at `/downloads/branch-for-mac.dmg`, and enables the download button on the setup page. Keep the installer outside the repository and supply it on each release build. Without an installer, the setup page points employees to their workplace’s software catalog or IT.

## Desktop Sync Probe

Open **Branch → Desktop Sync Probe** or click **Check window compatibility** after a failed setup to check whether a ChatGPT build exposes reply text and a reliable streaming signal. The diagnostic reads one selected window and copies only yes-or-no flags when you click **Copy results**.

1. On a Branch board, open **Account → Connect an agent → ChatGPT desktop → Troubleshooting an installed app** and click **Copy compatibility prompt**. The probe also has a copy button for the same prompt. Paste and send it in a new regular **Chat** in the ChatGPT macOS app. Wait for the reply, then pop that chat out into its own window.
2. In the probe, click **Request Accessibility Access…** if prompted, and allow the app under **System Settings → Privacy & Security → Accessibility**. Click **Find ChatGPT windows**, select the test window, and click **Watch selected window**.
3. When the probe finds the baseline, click **Copy streaming prompt** and send it in the same ChatGPT window. Leave that window open until the probe reports a result. Click **Copy results** to share the diagnostic flags.

A pass requires an idle baseline, a new reply with both markers, and a stop control that appeared during the reply and then disappeared. The report also indicates whether automatic sync recognized the baseline as a completed assistant reply. The probe checks the same window, title, and chat identity if the app exposes it. A timeout is inconclusive. It can mean the app did not expose a control or reply text in the expected form. The report distinguishes those cases. For a fresh run, start a new chat and reopen the probe to generate new streaming markers. Remove its Accessibility access from System Settings when you are done testing.

## Website-to-app link

Version 0.5.3 accepts a short-lived, single-use ticket when the signed-in editor starts a desktop connection from the board. The server records only the ticket hash, checks that the editor still has access when the Mac app redeems it, and binds the resulting sync key to the selected conversation and board. Earlier links can still give the Mac app a board hint, but those links open the browser board chooser. The setup handoff can supply an exact window title to select the current chat automatically. That title is passed only to the local Mac app.
