(() => {
 const boardId = new URLSearchParams(location.search).get('board');
 document.getElementById('open-mac').href = window.BranchMacSetup.boardSetupURL(boardId);

 // The deployment includes this manifest only when it ships a verified installer.
 window.BranchMacSetup.loadMacInstaller().then(installer => {
   if (!installer) return;
   document.getElementById('mac-download').href = installer;
   document.getElementById('direct-install').hidden = false;
   document.getElementById('managed-install').hidden = true;
  });
})();
