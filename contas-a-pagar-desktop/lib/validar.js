'use strict';
// Tudo que chega da tela pelo IPC é conferido aqui antes de ser usado.

function falha(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLECOES = ['servicos', 'compras'];
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TIPOS_NOTA = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const MAX_IMAGENS = 5;
const MAX_ARQUIVO_BYTES = 25 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_ARQUIVO_BYTES * 4 / 3) + 8;
const CHAVE_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

const colecao = v => { if (!COLECOES.includes(v)) throw falha('invalid_argument', 'Coleção inválida.'); return v; };
const id = v => { if (typeof v !== 'string' || !ID_RE.test(v)) throw falha('invalid_argument', 'Identificador inválido.'); return v; };
const numeroDeAssinatura = v => { if (!Number.isSafeInteger(v) || v < 1) throw falha('invalid_argument', 'Assinatura inválida.'); return v; };
const idDePedido = v => { if (typeof v !== 'string' || !ID_RE.test(v)) throw falha('invalid_argument', 'Pedido inválido.'); return v; };

function objeto(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw falha('invalid_argument', 'Era esperado um objeto.');
  return v;
}

function imagens(lista) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > MAX_IMAGENS) throw falha('image_rejected', 'Quantidade de imagens inválida.');
  return lista.map(i => {
    if (!i || !TIPOS_IMAGEM.includes(i.media_type) || typeof i.data !== 'string' || !i.data || i.data.length > MAX_BASE64) {
      throw falha('image_rejected', 'Imagem inválida.');
    }
    return { media_type: i.media_type, data: i.data };
  });
}

function arquivoDeNota(a) {
  objeto(a);
  const ext = Object.prototype.hasOwnProperty.call(TIPOS_NOTA, a.type) ? TIPOS_NOTA[a.type] : null;
  if (!ext) throw falha('unsupported_type', 'Tipo de arquivo não suportado.');
  if (typeof a.data !== 'string' || !a.data || a.data.length > MAX_BASE64) throw falha('too_large', 'Arquivo vazio ou grande demais.');
  const buf = Buffer.from(a.data, 'base64');
  if (!buf.length || buf.length > MAX_ARQUIVO_BYTES) throw falha('too_large', 'Arquivo vazio ou grande demais.');
  return { ext, buf };
}

function chave(v) {
  const k = String(v == null ? '' : v).trim();
  if (!CHAVE_RE.test(k)) throw falha('chave_formato', 'Isso não parece uma chave da API do Claude.');
  return k;
}

module.exports = { colecao, id, numeroDeAssinatura, idDePedido, objeto, imagens, arquivoDeNota, chave, COLECOES, MAX_IMAGENS, MAX_ARQUIVO_BYTES };
