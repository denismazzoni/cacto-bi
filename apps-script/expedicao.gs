/**
 * Cacto — endpoint do Google Sheets para o app de Expedição e Separação.
 *
 * Publicar em: Implantar › Nova implantação › Tipo "App da Web"
 *   Executar como .......: Eu
 *   Quem pode acessar ...: Qualquer pessoa
 * Copie a URL /exec e cole em Config › URL do Apps Script dentro do app.
 *
 * Recebe POST em text/plain (o app envia assim de propósito: content-type
 * text/plain não dispara o preflight OPTIONS, que o Apps Script não responde).
 *
 * Ações aceitas:
 *   {action:'separacao', abaSeparacao, abaItens, separacao:{...}, itens:[{...}]}
 *       Grava/atualiza uma separação e seus itens (upsert pelo ID — reenviar
 *       a mesma separação não duplica linhas).
 *   {sheet, row, data:{coluna: valor}}
 *       Formato antigo usado pelo dashboard Cacto BI (aba Acoes): atualiza a
 *       linha cuja primeira coluna vale `row`.
 */

var ID_PLANILHA = '';  // vazio = usa a planilha à qual o script está vinculado

function _planilha() {
  return ID_PLANILHA
    ? SpreadsheetApp.openById(ID_PLANILHA)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return _json({ ok: true, servico: 'cacto-expedicao', versao: 1 });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return _json({ ok: false, erro: 'ocupado' });
  }
  try {
    var corpo = (e && e.postData && e.postData.contents) || '{}';
    var req = JSON.parse(corpo);

    if (req.action === 'separacao') return _json(gravarSeparacao(req));
    if (req.sheet && req.data)      return _json(atualizarLinha(req));

    return _json({ ok: false, erro: 'acao_desconhecida' });
  } catch (err) {
    return _json({ ok: false, erro: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ── SEPARAÇÃO ─────────────────────────────────────────────────────────── */

function gravarSeparacao(req) {
  var ss = _planilha();
  var sep = req.separacao || {};
  var itens = req.itens || [];

  var abaSep = _aba(ss, req.abaSeparacao || 'Separacao', _cabecalho(sep));
  _upsert(abaSep, sep, 'ID');

  if (itens.length) {
    var abaIt = _aba(ss, req.abaItens || 'Separacao_Itens', _cabecalho(itens[0]));
    // Reenvio: apaga os itens antigos desta separação antes de regravar.
    _apagarPor(abaIt, 'ID_Separacao', sep.ID);
    _acrescentar(abaIt, itens);
  }

  return { ok: true, id: sep.ID, itens: itens.length };
}

function _cabecalho(obj) {
  return Object.keys(obj);
}

/** Devolve a aba, criando-a com cabeçalho quando não existir. */
function _aba(ss, nome, colunas) {
  var aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    aba.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
    aba.setFrozenRows(1);
    return aba;
  }
  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, colunas.length).setValues([colunas]);
    aba.setFrozenRows(1);
    return aba;
  }
  // Acrescenta ao cabeçalho colunas novas que ainda não existam.
  var atual = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
  var novas = colunas.filter(function (c) { return atual.indexOf(c) === -1; });
  if (novas.length) {
    aba.getRange(1, atual.length + 1, 1, novas.length).setValues([novas]);
    aba.getRange(1, 1, 1, atual.length + novas.length).setFontWeight('bold');
  }
  return aba;
}

function _colunas(aba) {
  return aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
}

function _linha(aba, obj) {
  return _colunas(aba).map(function (c) {
    return obj[c] !== undefined && obj[c] !== null ? obj[c] : '';
  });
}

/** Insere ou substitui a linha cujo valor em `chave` seja igual ao do objeto. */
function _upsert(aba, obj, chave) {
  var cols = _colunas(aba);
  var iChave = cols.indexOf(chave);
  var linha = _linha(aba, obj);

  if (iChave >= 0 && aba.getLastRow() > 1) {
    var valores = aba.getRange(2, iChave + 1, aba.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < valores.length; i++) {
      if (String(valores[i][0]) === String(obj[chave])) {
        aba.getRange(i + 2, 1, 1, linha.length).setValues([linha]);
        return;
      }
    }
  }
  aba.appendRow(linha);
}

function _acrescentar(aba, objs) {
  var linhas = objs.map(function (o) { return _linha(aba, o); });
  aba.getRange(aba.getLastRow() + 1, 1, linhas.length, linhas[0].length).setValues(linhas);
}

function _apagarPor(aba, coluna, valor) {
  if (aba.getLastRow() < 2) return;
  var cols = _colunas(aba);
  var i = cols.indexOf(coluna);
  if (i < 0) return;
  var valores = aba.getRange(2, i + 1, aba.getLastRow() - 1, 1).getValues();
  for (var r = valores.length - 1; r >= 0; r--) {
    if (String(valores[r][0]) === String(valor)) aba.deleteRow(r + 2);
  }
}

/* ── COMPATIBILIDADE COM O CACTO BI (aba Acoes) ────────────────────────── */

function atualizarLinha(req) {
  var ss = _planilha();
  var aba = ss.getSheetByName(req.sheet);
  if (!aba) return { ok: false, erro: 'aba_inexistente' };

  var cols = _colunas(aba);
  var chaves = aba.getRange(2, 1, Math.max(aba.getLastRow() - 1, 1), 1).getValues();

  for (var i = 0; i < chaves.length; i++) {
    if (String(chaves[i][0]) === String(req.row)) {
      Object.keys(req.data).forEach(function (c) {
        var j = cols.indexOf(c);
        if (j >= 0) aba.getRange(i + 2, j + 1).setValue(req.data[c]);
      });
      return { ok: true, linha: i + 2 };
    }
  }
  return { ok: false, erro: 'linha_nao_encontrada' };
}
