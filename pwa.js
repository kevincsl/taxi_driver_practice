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

  hideButton();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showButton();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
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
