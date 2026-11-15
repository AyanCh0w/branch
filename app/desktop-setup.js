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
  return `Help me connect this conversation to my team’s Branch board from ChatGPT or Codex.

Branch for Mac setup: https://joinbranch.dev/mac-setup.html
My board: ${board}

1. If Branch for Mac is missing, open the setup page. Use the Branch download if available, or tell me to install it through my workplace’s software catalog or IT.
2. Open my board and select Connect a conversation. If you know this chat’s exact title, include it in the URL-encoded mac-chat field in the board link’s fragment. If Branch asks, help me select this conversation and grant Accessibility access.

Keep this chat open. When Branch says Sync is on, new completed replies appear in the board’s Context view. Tell me where setup stopped if you can’t finish.`;
 }
 const api={handoff,appURL,boardSetupURL};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BranchMacSetup=api;
})(typeof window!=='undefined'?window:null);
