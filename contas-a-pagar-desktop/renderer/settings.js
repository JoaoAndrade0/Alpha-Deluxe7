'use strict';
// Janela de configurações: pasta de dados, chave da API do Claude e modelo.
(function () {
  const d = window.desktop;
  if (!d || !window.desktopCall) return;
  const call = window.desktopCall;
  const $ = id => document.getElementById(id);
  const dlg = $('cfg');
  let cfg = null, mustChooseFolder = false;

  const KEY_ERRORS = {
    chave_invalida: 'A chave não foi aceita. Confira se copiou inteira.',
    sem_saldo: 'A chave é válida, mas a conta da API está sem saldo. Adicione créditos em console.anthropic.com.',
    rate_limited: 'Limite de uso atingido. Tente de novo em instantes.',
    sem_internet: 'Sem conexão com a internet.'
  };

  function render(c) {
    cfg = c;
    $('cfg-dir').textContent = c.dataDir ? (c.storeReady ? c.root : c.dataDir + ' (não consegui abrir esta pasta)') : 'Nenhuma pasta escolhida';
    $('cfg-pick').textContent = c.dataDir ? 'Trocar pasta…' : 'Escolher pasta…';
    $('cfg-openfolder').hidden = !c.storeReady;
    $('cfg-clearkey').hidden = !c.hasKey;
    $('cfg-testkey').hidden = !c.hasKey;
    $('cfg-keystatus').textContent = c.hasKey ? 'Chave salva (' + c.keyHint + ').' : 'Nenhuma chave salva. Sem ela, o programa não lê notas, mas você pode lançar compras à mão.';
    const sel = $('cfg-model');
    if (!sel.options.length) {
      for (const m of c.models) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.append(o); }
    }
    sel.value = c.model;
    $('cfg-ver').textContent = 'Versão ' + c.version;
    $('cfg-close').disabled = !c.storeReady;
  }

  async function open(force) {
    try { render(await call('config:get')); } catch (e) { /* mantém o que já está na tela */ }
    mustChooseFolder = !!force || !cfg || !cfg.storeReady;
    if (!dlg.open) dlg.showModal();
  }
  window.openSettings = () => open(false);

  $('cfg-pick').addEventListener('click', async () => {
    try {
      const c = await call('config:chooseDir');
      if (!c) return;
      render(c);
      if (c.storeReady) location.reload(); // recarrega a tela com os dados da nova pasta
    } catch (e) { $('cfg-dir').textContent = 'Não foi possível abrir a pasta: ' + (e.message || e.code); }
  });
  $('cfg-openfolder').addEventListener('click', () => call('folder:open').catch(() => {}));

  $('cfg-savekey').addEventListener('click', async () => {
    const field = $('cfg-key');
    if (!field.value.trim()) { $('cfg-keystatus').textContent = 'Cole a chave no campo acima.'; return; }
    try {
      render(await call('config:setKey', field.value));
      field.value = '';
      $('cfg-keystatus').textContent = 'Chave salva. Clique em "Testar chave" para conferir.';
    } catch (e) { $('cfg-keystatus').textContent = 'Não foi possível salvar a chave.'; }
  });
  $('cfg-testkey').addEventListener('click', async () => {
    const st = $('cfg-keystatus');
    st.textContent = 'Testando…';
    try { await call('config:testKey'); st.textContent = 'A chave funciona.'; }
    catch (e) { st.textContent = KEY_ERRORS[e.code] || 'Não foi possível testar agora. Tente de novo.'; }
  });
  $('cfg-clearkey').addEventListener('click', async () => {
    try { render(await call('config:clearKey')); } catch (e) { /* ignora */ }
  });
  $('cfg-model').addEventListener('change', async e => {
    try { render(await call('config:setModel', e.target.value)); } catch (err) { /* ignora */ }
  });

  $('cfg-close').addEventListener('click', () => { if (!mustChooseFolder || (cfg && cfg.storeReady)) dlg.close(); });
  dlg.addEventListener('cancel', e => { if (mustChooseFolder && !(cfg && cfg.storeReady)) e.preventDefault(); }); // Esc não fecha antes de escolher a pasta
  $('cfg-btn').addEventListener('click', () => open(false));
  d.on('menu:settings', () => open(false));

  call('config:get').then(c => { render(c); if (!c.storeReady) open(true); }).catch(() => {});
})();
