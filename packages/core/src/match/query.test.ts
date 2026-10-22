import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lexicalQuery } from './query.js';

describe('lexicalQuery', () => {
  it('drops one- and two-letter fragments when a real word is left', () => {
    // "Труба ГД б/ш" before abbreviations were expanded: "b" and "sh" matched a cement brand.
    assert.equal(lexicalQuery('truba gd b sh'), 'truba');
  });

  it('keeps numbers, which are not fragments', () => {
    assert.equal(lexicalQuery('sement m 400'), 'sement 400');
  });

  it('searches a name made only of short words as written', () => {
    assert.equal(lexicalQuery('un'), 'un');
    assert.equal(lexicalQuery('ot'), 'ot');
    assert.equal(lexicalQuery('un 1'), 'un 1');
  });

  it('counts letters, not characters, when deciding a real word is present', () => {
    assert.equal(lexicalQuery('a4 b2'), 'a4 b2');
    assert.equal(lexicalQuery('a4 qogoz'), 'qogoz');
  });

  it('leaves an ordinary query unchanged and tolerates extra spaces', () => {
    assert.equal(lexicalQuery('coca cola'), 'coca cola');
    assert.equal(lexicalQuery('  coca   cola '), 'coca cola');
    assert.equal(lexicalQuery(''), '');
  });
});
