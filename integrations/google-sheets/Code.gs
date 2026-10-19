// MXIK Audit for Google Sheets. Uses the public API (/api/v1) with a key from Settings.
// The key and the server address are kept per user (User properties), never in the sheet.

var PROP_KEY = 'MXIK_API_KEY';
var PROP_BASE = 'MXIK_BASE_URL';
var BATCH = 20; // keep equal to API_CHECK_MAX_ITEMS on the server
var OUT_HEADERS = ['MXIK taklifi', 'Ishonch', 'Muammo', 'Izoh'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Panelni ochish', 'showSidebar')
    .addToUi();
}

function onInstall() {
  onOpen();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('MXIK Audit');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getSettings() {
  var props = PropertiesService.getUserProperties();
  return { baseUrl: props.getProperty(PROP_BASE) || '', hasKey: Boolean(props.getProperty(PROP_KEY)) };
}

function saveSettings(baseUrl, apiKey) {
  var props = PropertiesService.getUserProperties();
  var base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Manzil https:// bilan boshlanishi kerak.');
  props.setProperty(PROP_BASE, base);
  if (apiKey) props.setProperty(PROP_KEY, String(apiKey).trim());
  return getSettings();
}

function clearKey() {
  PropertiesService.getUserProperties().deleteProperty(PROP_KEY);
  return getSettings();
}

function request_(path, options) {
  var props = PropertiesService.getUserProperties();
  var base = props.getProperty(PROP_BASE);
  var key = props.getProperty(PROP_KEY);
  if (!base || !key) throw new Error('Avval manzil va API kalitini saqlang.');
  var params = Object.assign({ muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + key } }, options);
  var response = UrlFetchApp.fetch(base + path, params);
  var body = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() >= 300) {
    var message = body && body.error ? body.error.message : 'Server xatosi (' + response.getResponseCode() + ')';
    throw new Error(message);
  }
  return body;
}

// Finds the column that holds a field from the header row; -1 when absent.
function findColumn_(headers, hints) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase();
    for (var j = 0; j < hints.length; j++) if (h.indexOf(hints[j]) !== -1) return i;
  }
  return -1;
}

function detectColumns_(headers) {
  return {
    name: findColumn_(headers, ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'name', 'product']),
    barcode: findColumn_(headers, ['shtrix', 'штрих', 'barcode', 'ean', 'gtin']),
    mxik: findColumn_(headers, ['mxik', 'ikpu', 'мхик', 'икпу', 'spic']),
    unit: findColumn_(headers, ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit']),
  };
}

function cell_(row, index) {
  return index < 0 ? null : String(row[index] === undefined ? '' : row[index]).trim() || null;
}

// Checks the rows below the header row and writes the result to four columns on the right.
function checkSheet() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) throw new Error('Varaqda tekshiriladigan qator yoʻq.');
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var cols = detectColumns_(values[0]);
  if (cols.name < 0) throw new Error('Birinchi qatorda tovar nomi ustuni topilmadi.');

  var outStart = lastCol + 1;
  sheet.getRange(1, outStart, 1, OUT_HEADERS.length).setValues([OUT_HEADERS]).setFontWeight('bold');

  var done = 0;
  for (var from = 1; from < values.length; from += BATCH) {
    var slice = values.slice(from, from + BATCH);
    var items = [];
    var positions = [];
    slice.forEach(function (row, i) {
      var name = cell_(row, cols.name);
      if (!name) return;
      items.push({ name: name, barcode: cell_(row, cols.barcode), unit: cell_(row, cols.unit), mxik: cell_(row, cols.mxik) });
      positions.push(from + i);
    });
    if (items.length === 0) continue;
    var results = request_('/api/v1/check', {
      method: 'post', contentType: 'application/json', payload: JSON.stringify({ items: items }),
    }).results;
    results.forEach(function (result, i) {
      var first = result.findings[0];
      var line = first
        ? [first.suggestedMxik || '', first.confidence === null ? '' : Math.round(first.confidence * 100) + '%', first.type, first.reason]
        : ['', '', 'OK', ''];
      sheet.getRange(positions[i] + 1, outStart, 1, OUT_HEADERS.length).setValues([line]);
    });
    done += items.length;
    SpreadsheetApp.flush();
  }
  return { checked: done };
}

// Sends the whole sheet as a CSV catalogue; the audit runs on the server.
function uploadSheet() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var values = sheet.getDataRange().getDisplayValues();
  var csv = values.map(function (row) {
    return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var blob = Utilities.newBlob('﻿' + csv, 'text/csv', sheet.getName() + '.csv');
  var body = request_('/api/v1/catalogs', { method: 'post', payload: { file: blob } });
  PropertiesService.getDocumentProperties().setProperty('MXIK_LAST_CATALOG', body.id);
  return { id: body.id, rows: body.rows };
}

function reportStatus() {
  var id = PropertiesService.getDocumentProperties().getProperty('MXIK_LAST_CATALOG');
  if (!id) throw new Error('Hali katalog yuklanmagan.');
  var body = request_('/api/v1/catalogs/' + id + '/report?limit=1', { method: 'get' });
  return { id: id, status: body.status, progress: body.progress, summary: body.summary || {} };
}
