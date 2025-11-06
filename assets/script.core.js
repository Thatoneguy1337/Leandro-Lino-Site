if ('serviceWorker' in navigator) {
  // Registra SW com escopo amplo
  navigator.serviceWorker.register('/service-worker.js', { 
    scope: '/' 
  }).then((registration) => {
    console.log('SW registered:', registration);
    
    // ⚡ Força atualização se nova versão disponível
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // Nova versão pronta! Ativa imediatamente
          newWorker.postMessage('skipWaiting');
        }
      });
    });
  }).catch(console.error);

  // Detecta quando SW assume controle
  navigator.serviceWorker.ready.then(() => {
    console.log('SW ready - app fully controlled');
  });
}