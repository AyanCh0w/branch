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
  return validBoard(boardId)?'https://joinbranch.dev/app?board='+encodeURIComponent(boardId)+'#mac-sync=open':'https://joinbranch.dev/app';
 }
 function handoff(boardId){
  const board=boardSetupURL(boardId);
  return `Help me connect this conversation in the ChatGPT desktop app to my team’s Branch board.

1. If Branch for Mac is missing, use https://joinbranch.dev/mac-setup.html. If the download is unavailable, direct me to my workplace’s software catalog or IT.
2. Open ${board} and select Open Branch for Mac. If you know this chat’s exact title, add it as the URL-encoded mac-chat field in the link’s fragment before opening it. In Branch for Mac, select this conversation and click Connect conversation if needed. If macOS asks for Accessibility access, guide me through allowing it.

When Branch says Sync is on, help me verify that a new reply appears in the board’s Context. If setup stops, tell me which step needs attention.`;
 }
 const api={handoff,appURL,boardSetupURL};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BranchMacSetup=api;
})(typeof window!=='undefined'?window:null);
