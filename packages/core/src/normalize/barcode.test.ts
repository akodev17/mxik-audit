import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barcodeIdentity, hasValidCheckDigit, identifyingBarcode, isRestrictedCirculation } from './barcode.js';

describe('hasValidCheckDigit', () => {
  it('accepts real GTINs of every length once padded', () => {
    for (const gtin of ['04780074540164', '04601501483581', '00000096385074', '00212345678909', '10012345678902']) {
      assert.equal(hasValidCheckDigit(gtin), true, gtin);
    }
  });

  it('rejects a single wrong digit', () => {
    assert.equal(hasValidCheckDigit('04780074540165'), false);
    assert.equal(hasValidCheckDigit('04780074540174'), false);
  });

  it('rejects anything that is not 14 digits', () => {
    assert.equal(hasValidCheckDigit('4780074540164'), false);
    assert.equal(hasValidCheckDigit('0478007454016x'), false);
  });
});

describe('isRestrictedCirculation', () => {
  it('flags EAN-13 prefixes 02, 04 and 20-29', () => {
    for (const gtin of ['00212345678909', '00412345678903', '02000000000015', '02912345000004']) {
      assert.equal(isRestrictedCirculation(gtin), true, gtin);
    }
  });

  it('leaves ordinary GS1 prefixes alone', () => {
    for (const gtin of ['04780074540164', '00312345678906', '03001234567892', '00000096385074', '10012345678902']) {
      assert.equal(isRestrictedCirculation(gtin), false, gtin);
    }
  });
});

describe('barcodeIdentity', () => {
  it('returns the padded GTIN for an identifying barcode', () => {
    assert.deepEqual(barcodeIdentity('4780074540164'), { status: 'ok', gtin: '04780074540164' });
    assert.deepEqual(barcodeIdentity('4780-0745-40164'), { status: 'ok', gtin: '04780074540164' });
    assert.equal(identifyingBarcode('96385074'), '00000096385074');
  });

  it('says why a barcode cannot identify the product', () => {
    assert.equal(barcodeIdentity(null).status, 'absent');
    assert.equal(barcodeIdentity('  ').status, 'absent');
    assert.equal(barcodeIdentity('12345678901').status, 'bad_length');
    assert.equal(barcodeIdentity('4780074540165').status, 'bad_check_digit');
    assert.equal(barcodeIdentity('2000000000015').status, 'restricted');
    assert.equal(barcodeIdentity('212345678909').status, 'restricted');
  });

  it('never hands out a GTIN unless it identifies a product', () => {
    for (const raw of ['4780074540165', '2000000000015', '0412345678903', '12345678']) {
      assert.equal(identifyingBarcode(raw), null, raw);
    }
  });
});
