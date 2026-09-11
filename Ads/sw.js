self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e){
  var dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch (err) { dados = { title: 'CRM Novva', body: e.data ? e.data.text() : 'Nova mensagem' }; }
  var titulo = dados.title || 'CRM Novva';
  var opcoes = {
    body: dados.body || 'Chegou mensagem nova',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: dados.url || './crm.html' },
    tag: dados.tag || 'crm-novva',
    renotify: true,
  };
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './crm.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(lista){
      for (var i = 0; i < lista.length; i++){
        if (lista[i].url.indexOf('crm.html') !== -1 && 'focus' in lista[i]) return lista[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
