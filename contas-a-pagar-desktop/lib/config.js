'use strict';
// Configurações deste computador: pasta de dados, modelo e chave da API do Claude.
// A chave é guardada criptografada pelo sistema (safeStorage) e nunca vai para a pasta compartilhada.

const fs = require('fs');
const path = require('path');

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (mais preciso, recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (equilibrado)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (mais barato)' }
];
const DEFAULT_MODEL = MODELS[0].id;

class Config {
  constructor(file, safeStorage) {
    this.file = file;
    this.safe = safeStorage || null;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { this.data = {}; }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get dataDir() { return this.data.dataDir || ''; }
  get model() { return MODELS.some(m => m.id === this.data.model) ? this.data.model : DEFAULT_MODEL; }

  setDataDir(dir) { this.data.dataDir = String(dir || ''); this._save(); }

  setModel(id) {
    if (!MODELS.some(m => m.id === id)) throw new Error('Modelo desconhecido.');
    this.data.model = id; this._save();
  }

  setKey(key) {
    key = String(key || '').trim();
    if (!key) throw new Error('Informe a chave.');
    if (this.safe && this.safe.isEncryptionAvailable()) {
      this.data.apiKeyEnc = this.safe.encryptString(key).toString('base64');
      delete this.data.apiKeyPlain;
    } else {
      this.data.apiKeyPlain = key;
      delete this.data.apiKeyEnc;
    }
    this._save();
  }

  clearKey() { delete this.data.apiKeyEnc; delete this.data.apiKeyPlain; this._save(); }

  getKey() {
    try {
      if (this.data.apiKeyEnc && this.safe) return this.safe.decryptString(Buffer.from(this.data.apiKeyEnc, 'base64'));
    } catch (e) { return ''; }
    return this.data.apiKeyPlain || '';
  }

  // Mostra só o final da chave na tela.
  keyHint() {
    const k = this.getKey();
    return k ? '…' + k.slice(-4) : '';
  }

  publicView() {
    return { dataDir: this.dataDir, model: this.model, models: MODELS, hasKey: !!this.getKey(), keyHint: this.keyHint() };
  }
}

module.exports = { Config, MODELS, DEFAULT_MODEL };
