(function(root){
 const validBoard = id => /^[A-Za-z0-9_-]{1,160}$/.test(id || '');
 function appURL(boardId, {ticket, chatTitle} = {}) {
  const params = new URLSearchParams();
  if (validBoard(boardId)) params.set('board', boardId);
  if (params.has('board') && /^branch_desktop_launch_[0-9]{13}_[a-f0-9]{64}$/.test(ticket || '')) params.set('ticket', ticket);
  if (chatTitle?.trim() && [...chatTitle].length <= 240 && !/[\u0000-\u001f\u007f-\u009f]/.test(chatTitle)) params.set('chat', chatTitle);
  return 'joinbranch://connect' + (params.size ? '?' + params.toString().replaceAll('+', '%20') : '');
 }
 function boardSetupURL(boardId){
  return validBoard(boardId)?'https://joinbranch.dev/app?board='+encodeURIComponent(boardId)+'#mac-sync=1':'https://joinbranch.dev/app';
 }
 function handoff(boardId){
  const board=boardSetupURL(boardId);
  return `Set up Branch for Mac now so new completed replies in this exact ChatGPT desktop chat can go to my Branch board.

Repository: https://github.com/AyanCh0w/branch
Setup guide: https://joinbranch.dev/mac-setup.html
Destination: ${board}

1. Use Branch for Mac 0.5.3 or newer. If a build is needed, preserve local changes and follow desktop/README.md. Run swift test --package-path desktop and sh desktop/build-probe.sh. Open Destination in my signed-in browser. If the exact title of this ChatGPT window is available, add it as the URL-encoded mac-chat field in the same URL fragment so Branch can select this chat. Keep this chat open. If it has no earlier replies, finish your response so Branch has a completed reply to read.
2. Leave me at Connect ChatGPT to this board. That action opens the Mac app with this board already authorized. If the chat was not identified, help me select this chat there. If macOS asks for Accessibility access, let me grant it.

Carry out the setup steps you can, then report Branch’s status. New completed replies in this chat go to the board’s Context view.`;
 }
 const api={handoff,appURL,boardSetupURL};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BranchMacSetup=api;
})(typeof window!=='undefined'?window:null);
