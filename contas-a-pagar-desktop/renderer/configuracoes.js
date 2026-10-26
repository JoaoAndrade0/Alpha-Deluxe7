'use strict';
// Janela de configurações: pasta de dados, chave da API do Claude e modelo.
(function () {
  const C = (window.Contas = window.Contas || {});
  if (!C.ponte) return;
  const chamar = C.ponte.chamar;
  const $ = id => document.getElementById(id);
  const dlg = $('cfg');
  let cfg = null, exigirPasta = false;

  function desenhar(c) {
    cfg = c;
    $('cfg-dir').textContent = c.dataDir ? (c.storeReady ? c.root : c.dataDir + ' (não consegui abrir esta pasta)') : 'Nenhuma pasta escolhida';
    $('cfg-pick').textContent = c.dataDir ? 'Trocar pasta…' : 'Escolher pasta…';
    $('cfg-openfolder').hidden = !c.storeReady;
    $('cfg-clearkey').hidden = !c.hasKey;
    $('cfg-testkey').hidden = !c.hasKey;
    $('cfg-keystatus').textContent = c.hasKey ? 'Chave salva (' + c.keyHint + ').' : 'Nenhuma chave salva. Sem ela, o programa não lê notas, mas você pode lançar compras à mão.';
    $('cfg-keywarn').hidden = c.keyStorage !== 'arquivo';
    const sel = $('cfg-model');
    if (!sel.options.length) {
      for (const m of c.models) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.append(o); }
    }
    sel.value = c.model;
    $('cfg-ver').textContent = 'Versão ' + c.version;
    $('cfg-close').disabled = !c.storeReady;
  }

  async function abrir(forcar) {
    try { desenhar(await chamar('config:get')); } catch (e) { /* mantém o que já está na tela */ }
    exigirPasta = !!forcar || !cfg || !cfg.storeReady;
    if (!dlg.open) dlg.showModal();
  }
  C.abrirConfiguracoes = () => abrir(false);

  $('cfg-pick').addEventListener('click', async () => {
    try {
      const c = await chamar('config:chooseDir');
      if (!c) return;
      desenhar(c);
      if (c.storeReady) location.reload(); // recarrega a tela com os dados da nova pasta
    } catch (e) { $('cfg-dir').textContent = 'Não foi possível abrir a pasta: ' + (e.message || e.code); }
  });
  $('cfg-openfolder').addEventListener('click', () => chamar('folder:open').catch(() => {}));

  $('cfg-savekey').addEventListener('click', async () => {
    const campo = $('cfg-key'), st = $('cfg-keystatus');
    if (!campo.value.trim()) { st.textContent = 'Cole a chave no campo acima.'; return; }
    try {
      desenhar(await chamar('config:setKey', campo.value));
      campo.value = '';
      st.textContent = 'Chave salva. Clique em "Testar chave" para conferir.';
    } catch (e) { st.textContent = C.mensagemDeChave(e, 'Não foi possível salvar a chave.'); }
  });
  $('cfg-testkey').addEventListener('click', async () => {
    const st = $('cfg-keystatus');
    st.textContent = 'Testando…';
    try { await chamar('config:testKey'); st.textContent = 'A chave funciona.'; }
    catch (e) { st.textContent = C.mensagemDeChave(e, 'Não foi possível testar agora. Tente de novo.'); }
  });
  $('cfg-clearkey').addEventListener('click', async () => {
    try { desenhar(await chamar('config:clearKey')); } catch (e) { /* ignora */ }
  });
  $('cfg-model').addEventListener('change', async e => {
    try { desenhar(await chamar('config:setModel', e.target.value)); } catch (err) { /* ignora */ }
  });

  $('cfg-close').addEventListener('click', () => { if (!exigirPasta || (cfg && cfg.storeReady)) dlg.close(); });
  dlg.addEventListener('cancel', e => { if (exigirPasta && !(cfg && cfg.storeReady)) e.preventDefault(); }); // Esc não fecha antes de escolher a pasta
  $('cfg-btn').addEventListener('click', () => abrir(false));
  C.ponte.aoReceber('menu:settings', () => abrir(false));

  chamar('config:get').then(c => { desenhar(c); if (!c.storeReady) abrir(true); }).catch(() => {});
})();
