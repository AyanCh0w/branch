(function(root){
 function handoff(boardId){
  const board=/^[A-Za-z0-9_-]{1,160}$/.test(boardId||'')?'https://joinbranch.dev/app?board='+encodeURIComponent(boardId):'https://joinbranch.dev/app';
  return `Help me install and set up Branch for Mac so new completed replies from a ChatGPT conversation can sync to my Branch board.

Repository: https://github.com/AyanCh0w/branch
Setup guide: https://joinbranch.dev/mac-setup.html
Destination: ${board}

1. Check that this is macOS 14 or newer with Swift 6.1 or newer. Find an existing Branch checkout or clone the repository. Preserve uncommitted work; use a separate checkout if needed. Read AGENTS.md and desktop/README.md before changing anything.
2. Review the desktop source and build scripts. In the repository, run swift test --package-path desktop and sh desktop/build-probe.sh. A configured Apple signing identity builds Branch for Mac; otherwise the local preview is named Branch Desktop Probe. Do not invent a signed or notarized release, disable Gatekeeper, remove quarantine flags, or change system security settings to make it open.
3. Open the built app with my approval where required. Guide me through macOS Accessibility permission, explaining that it allows the app to read screen text. Keep this permission limited to this app; do not enable unrelated permissions. If system authentication or a security warning requires me, pause there.
4. Open the destination in Branch and let me sign in. Ask me to choose the ChatGPT Mac conversation and destination board. In the menu-bar app, choose Connect chat and complete the board approval in the browser. Use the app's pairing prompt only if it needs to identify the conversation; a baseline prompt alone is not installation or pairing. Never request my passwords, API keys, or existing chat history.
5. Wait for the app to say Syncing, then test with one new non-sensitive reply. Verify it appears in the board's Context view without refreshing. Existing replies are a baseline, not an automatic history import. Verify Stop syncing or Disconnect revokes future writes. If you cannot control ChatGPT, ask me to send the test message rather than working around that restriction.
6. Tell me the installed app's exact location, how to reopen it, and what was actually verified. Do not call it connected until the new reply arrives. If building or permission approval is blocked, explain that specific next step.`;
 }
 const api={handoff};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BranchMacSetup=api;
})(typeof window!=='undefined'?window:null);
