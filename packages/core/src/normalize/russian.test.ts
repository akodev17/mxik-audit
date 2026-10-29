import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headNoun, headNouns, headStem, isAdjectiveRu, rowHead } from './russian.js';

describe('isAdjectiveRu', () => {
  it('reads adjectives and participles by their endings', () => {
    for (const w of ['Сетевой', 'электрический', 'моющие', 'защитное', 'канцелярская', 'рассасывающиеся']) assert.equal(isAdjectiveRu(w), true, w);
    for (const w of ['принтер', 'реле', 'кабель', 'ручка', 'жалюзи', 'шкаф']) assert.equal(isAdjectiveRu(w), false, w);
  });
});

describe('rowHead', () => {
  it('is the first noun of a procurement name, wherever its adjectives stand', () => {
    const cases: [string, string][] = [
      ['Принтер', 'принтер'],
      ['Сетевой кабель', 'кабель'],
      ['Реле защитное', 'реле'],
      ['Светодиодный прожектор', 'прожектор'],
      ['LED панель', 'панель'],
      ['3D-принтер', 'принтер'],
      ['Средства моющие для стекол и зеркал', 'средства'],
      ['Услуга по ремонту жалюзи', 'услуга'],
      ['Перчатки резиновые общего назначения (кроме медицинских)', 'перчатки'],
      ['Нити хирургические рассасывающиеся натуральные', 'нити'],
    ];
    for (const [name, head] of cases) assert.equal(rowHead(name), head, name);
  });

  it('has none for Uzbek, Latin or adjective-only names', () => {
    for (const name of ["Mol go'shtli shashlik", 'Қўй гўшти', 'Printer HP', 'Электрический', 'для принтера']) assert.equal(rowHead(name), null, name);
  });
});

describe('headNouns', () => {
  it('lists every noun a classifier name offers as what the code is', () => {
    const has = (name: string, heads: string[]): void => {
      const got = headNouns(name);
      for (const h of heads) assert.ok(got.has(h), `${name}: ${[...got].join(', ')}`);
    };
    has('Сетевые маршрутизаторы, модемы,  роутеры и коммутаторы', ['маршрутизаторы', 'модемы', 'роутеры', 'коммутаторы']);
    has('Щит (шкаф) распределительный для электрического тока', ['щит', 'шкаф']);
    has('Сетевой фильтр (удлинитель)', ['фильтр', 'удлинитель']);
    has('Металлоконструкции из черных металлов: Опоры (мачты) ВЛ 110 кВ', ['металлоконструкции', 'опоры', 'мачты']);
  });

  it('stops at a preposition and skips filler, so a dependent noun is not a head', () => {
    assert.deepEqual([...headNouns('Тонер для принтера')], ['тонер']);
    assert.deepEqual([...headNouns('Ручки шариковые и прочие (всех видов)')], ['ручки']);
    assert.deepEqual([...headNouns('Подгузники: EVONY, для взрослых 120-170 см, 8 шт')], ['подгузники']);
    assert.equal(headNoun('для взрослых'), null);
  });
});

describe('headStem', () => {
  it('ignores number, so the classifier plural meets the row singular', () => {
    const same: [string, string][] = [
      ['принтер', 'принтеры'], ['ручка', 'ручки'], ['разбавитель', 'разбавители'], ['изделие', 'изделия'],
      ['средство', 'средства'], ['нить', 'нити'], ['батарея', 'батареи'], ['Реле', 'реле'], ['стёкла', 'стекла'],
    ];
    for (const [a, b] of same) assert.equal(headStem(a), headStem(b), `${a} ~ ${b}`);
  });

  it('keeps different nouns apart and folds the few heads that mean the same', () => {
    assert.notEqual(headStem('тонер'), headStem('принтер'));
    assert.notEqual(headStem('щит'), headStem('шкаф'));
    assert.equal(headStem('работы'), headStem('услуги'));
    assert.equal(headStem('аппаратура'), headStem('аппараты'));
  });
});
