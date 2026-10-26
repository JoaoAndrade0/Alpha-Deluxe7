'use strict';
// Prepara o arquivo escolhido antes de enviar: foto vira JPEG de tamanho razoável; PDF vira imagens das primeiras páginas.
(function () {
  const C = (window.Contas = window.Contas || {});
  const LADO_MAX_FOTO = 2200;
  const PAGINAS_PDF = 3;
  const PDFJS = '/vendor/pdfjs/'; // o leitor de PDF (pdf.js) vem junto com o programa

  const ehPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

  function carregarImagem(arquivo) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(arquivo), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
      im.src = url;
    });
  }

  function paraBlobJpeg(canvas) {
    return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('blob'))), 'image/jpeg', 0.82));
  }

  function canvasBranco(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    return { c, g };
  }

  async function paraJpeg(arquivo) {
    try {
      let origem;
      try { origem = await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); } catch (e) { origem = await carregarImagem(arquivo); }
      const w = origem.naturalWidth || origem.width, h = origem.naturalHeight || origem.height;
      const escala = Math.min(1, LADO_MAX_FOTO / Math.max(w, h));
      const { c, g } = canvasBranco(w * escala, h * escala);
      g.drawImage(origem, 0, 0, c.width, c.height);
      return await paraBlobJpeg(c);
    } catch (e) { throw { code: 'img' }; }
  }

  let carregandoPdfjs = null;
  function carregarPdfjs() {
    if (!carregandoPdfjs) {
      carregandoPdfjs = import(PDFJS + 'pdf.min.mjs')
        .then(lib => { lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return lib; })
        .catch(e => { carregandoPdfjs = null; throw e; });
    }
    return carregandoPdfjs;
  }

  // Devolve as imagens das primeiras páginas e quantas páginas o PDF tem (para avisar se alguma ficou de fora).
  async function pdfParaImagens(arquivo, maxPaginas) {
    let tarefa = null;
    try {
      const lib = await carregarPdfjs();
      tarefa = lib.getDocument({
        data: new Uint8Array(await arquivo.arrayBuffer()),
        isEvalSupported: false, // não executa código embutido no PDF
        cMapUrl: PDFJS + 'cmaps/', cMapPacked: true,
        standardFontDataUrl: PDFJS + 'standard_fonts/',
        wasmUrl: PDFJS + 'wasm/'
      });
      const pdf = await tarefa.promise;
      const imagens = [];
      for (let i = 1; i <= Math.min(pdf.numPages, PAGINAS_PDF, maxPaginas); i++) {
        const pagina = await pdf.getPage(i);
        const v0 = pagina.getViewport({ scale: 1 });
        const vp = pagina.getViewport({ scale: Math.min(4, 2000 / Math.max(v0.width, v0.height)) });
        const { c, g } = canvasBranco(vp.width, vp.height);
        await pagina.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
        imagens.push(await paraBlobJpeg(c));
      }
      return { imagens, totalPaginas: pdf.numPages };
    } catch (e) { console.error('Falha ao abrir o PDF:', e); throw { code: 'pdf' }; }
    finally { if (tarefa) await tarefa.destroy().catch(() => {}); }
  }

  C.preparo = { ehPdf, paraJpeg, pdfParaImagens };
})();
