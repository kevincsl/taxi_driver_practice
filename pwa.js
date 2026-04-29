(() => {
  const installButton = document.getElementById("installAppBtn");
  let deferredPrompt = null;

  if (!installButton) {
    return;
  }

  const showButton = () => {
    installButton.hidden = false;
    installButton.disabled = false;
  };

  const hideButton = () => {
    installButton.hidden = true;
    installButton.disabled = true;
  };

  showButton();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showButton();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      window.alert("此瀏覽器目前未提供自動安裝提示。請用瀏覽器選單中的「安裝應用程式 / Add to Home Screen」。");
      return;
    }

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (choice.outcome === "accepted") {
      hideButton();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideButton();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // Keep UI usable even if service worker registration fails.
      });
    });
  }
})();
