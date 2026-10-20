/* Apply the saved local-clock appearance before styles paint. No network or account access. */
(()=>{
  let mode='auto';try{const saved=localStorage.getItem('oscar-office-theme-v1');if(['auto','light','dark'].includes(saved))mode=saved;}catch{}
  const hour=new Date().getHours(),theme=mode==='auto'?(hour>=20||hour<8?'dark':'light'):mode;
  document.documentElement.dataset.officeTheme=theme;document.documentElement.dataset.officeThemeMode=mode;
})();
