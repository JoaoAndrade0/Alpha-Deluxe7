'use strict';
// Ponte mínima e fechada entre a tela e o programa: só os canais abaixo funcionam.

const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'config:get', 'config:chooseDir', 'config:setKey', 'config:clearKey', 'config:setModel', 'config:testKey',
  'shell:open', 'folder:open', 'export:csv',
  'db:list', 'db:get', 'db:set', 'db:update', 'db:delete', 'db:subscribe', 'db:unsubscribe',
  'nota:save', 'nota:ler', 'nota:cancel'
]);
const ON = new Set(['db:snapshot', 'db:error', 'menu:settings']);

contextBridge.exposeInMainWorld('desktop', {
  invoke: (channel, ...args) => (INVOKE.has(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Canal não permitido.'))),
  on: (channel, cb) => { if (ON.has(channel)) ipcRenderer.on(channel, (_event, ...args) => cb(...args)); }
});
