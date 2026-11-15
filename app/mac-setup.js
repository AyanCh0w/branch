(() => {
 const boardId = new URLSearchParams(location.search).get('board');
 document.getElementById('open-mac').href = window.BranchMacSetup.boardSetupURL(boardId);

 // The deployment includes this manifest only when it ships a verified installer.
 fetch('/downloads/mac-release.json', { redirect: 'error' })
  .then(response => response.ok ? response.json() : null)
  .then(release => {
   if (release?.installer !== '/downloads/branch-for-mac.dmg') return;
   document.getElementById('direct-install').hidden = false;
   document.getElementById('managed-install').hidden = true;
  })
  .catch(() => {});
})();
