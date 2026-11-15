(function(root){
 function appURL(boardId){return "joinbranch://connect"+(/^[A-Za-z0-9_-]{1,160}$/.test(boardId||'')?"?board="+encodeURIComponent(boardId):"");}
 function handoff(boardId){
  const board=/^[A-Za-z0-9_-]{1,160}$/.test(boardId||'')?'https://joinbranch.dev/app?board='+encodeURIComponent(boardId):'https://joinbranch.dev/app';
  return `Set up Branch for Mac now so new completed replies in this exact ChatGPT desktop chat can go to my Branch board.

Repository: https://github.com/AyanCh0w/branch
Setup guide: https://joinbranch.dev/mac-setup.html
Destination: ${board}
Mac pairing link: ${appURL(boardId)}

1. Use the installed Branch for Mac 0.5.2 or newer. If needed, find or clone the repository, preserve local changes, and follow desktop/README.md. Run swift test --package-path desktop and sh desktop/build-probe.sh if a build is needed. Open the Mac pairing link locally. If you can verify the exact title of this ChatGPT window, include it as the URL-encoded chat query parameter so Branch can select this chat and open board approval. If the title is unavailable, open the pairing link and let me select this chat from the picker. Keep this conversation open. If it has no earlier replies, finish your response so Branch has a completed reply to read.
2. Leave me at Approve this board in the browser. If macOS asks for Accessibility permission or Branch needs me to sign in, tell me what to approve and resume afterward. Once Branch says Connected, the next completed reply in this chat will appear in the board's Context view.

Complete the setup steps you can in this session. Keep the chat title in the local Mac link. Leave board approval to me. Report the actual status shown by Branch.`;
 }
 const api={handoff,appURL};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BranchMacSetup=api;
})(typeof window!=='undefined'?window:null);
