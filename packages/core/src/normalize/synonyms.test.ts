import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeName } from './index.js';
import { applySynonyms, SYNONYMS } from './synonyms.js';

/** The lexical query the pipeline builds for a row name, before fragments are dropped. */
const query = (name: string): string => normalizeName(name).queryKey;

describe('applySynonyms', () => {
  it('reads rebar as the classifier names it, in both scripts', () => {
    for (const name of ['Арматура А500С ф12', 'Armatura 14 mm', 'Арматура 10-12', 'Арм. 12']) {
      const r = applySynonyms(query(name));
      assert.match(r.text, /\bprokat armaturniy\b/, name);
      assert.doesNotMatch(r.text, /\barmatura\b/, `${name}: the ambiguous word is replaced`);
      assert.deepEqual(r.applied, ['арматура → прокат арматурный']);
    }
  });

  it('leaves pipe fittings alone: "арматура" next to a pipe, valve or plastic word', () => {
    for (const name of ['Арматура для труб ПП', 'Арматура запорная', 'Кран шаровой арматура', 'Plastik quvur armatura', 'Арматура смывная для бачка']) {
      const r = applySynonyms(query(name));
      assert.doesNotMatch(r.text, /prokat/, name);
      assert.ok(!r.applied.some((a) => a.startsWith('арматура')), name);
    }
  });

  it('adds the classifier wording for angle steel and keeps the seller word', () => {
    const r = applySynonyms(query('Уголок 50х50х5'));
    assert.equal(r.text, 'ugolok ugloviye profili uglovaya stal');
  });

  it('leaves corners that are not angle steel alone (re-audit of the 423-row file)', () => {
    for (const name of ['Уголок перфорированный', 'Уголок ПВХ белый 3м', 'Уголок мебельный', 'Уголок алюминиевый 20х20']) {
      assert.deepEqual(applySynonyms(query(name)).applied, [], name);
    }
  });

  it('replaces "минвата", which no classifier name uses', () => {
    assert.equal(applySynonyms(query('Минвата Rockwool 50мм')).text, 'mineralnaya vata rockwool');
  });

  it('adds the insulation and block terms beside the seller word', () => {
    assert.match(applySynonyms(query('Утеплитель базальтовый')).text, /^uteplitel teploizolyatsionniye bazaltoviy$/);
    assert.match(applySynonyms(query('Газоблок D500')).text, /gazoblok gazosilikatniye bloki/);
    assert.match(applySynonyms(query('Пеноблок D600')).text, /penoblok penobetonniy blok/);
    assert.match(applySynonyms(query('Керамзитоблок 390х190х188')).text, /keramzitoblok keramzitniy blok/);
  });

  it('spells out polypropylene for ПП and PPR, before short fragments are dropped', () => {
    assert.match(applySynonyms(query('Труба ПП PN20 25мм')).text, /\bpolipropilenoviye\b/);
    assert.match(applySynonyms(query('Truba PPR 20 mm')).text, /\bpolipropilenoviye\b/);
  });

  it('changes nothing, and reports nothing, for a name without a synonym', () => {
    assert.deepEqual(applySynonyms(query('Лист г/к 2,0х1250х2500')), { text: query('Лист г/к 2,0х1250х2500'), applied: [], added: [], groups: [] });
  });

  it('fires each entry once and never repeats a word already in the query', () => {
    const r = applySynonyms('ugolok ugolok profili');
    // The term follows the first trigger; "profili" was already there.
    assert.equal(r.text, 'ugolok ugloviye uglovaya stal ugolok profili');
    assert.equal(r.applied.length, 1);
    assert.deepEqual(r.added, ['ugloviye', 'uglovaya', 'stal']);
  });

  it('never changes the normalised name itself, only the lexical query', () => {
    const n = normalizeName('Арматура А500С ф12');
    applySynonyms(n.queryKey);
    assert.match(n.matchKey, /armatura/);
  });

  it('has a test for every entry', () => {
    // Guard: an entry added without a case here or below fails this count.
    assert.equal(SYNONYMS.length, 51);
  });
});

/** A row as the pipeline passes it: the name as written, its unit and its own code. */
const row = (name: string, unit: string | null = null, existingMxik: string | null = null) =>
  applySynonyms(query(name), { name, unit, existingMxik });

const CAFE = 'umumiy ovqatlanish shaxobchalarida tayyorlangan';

describe('applySynonyms: the catering lexicon (plan §8, 2026-10-28)', () => {
  it('reads a dish by name as its family of the food-service menu, in every script', () => {
    const cases: [string, RegExp][] = [
      ['Palov 1 porsiya', /^palov asosiy taomlar umumiy ovqatlanish shaxobchalarida tayyorlangan goshtli s myasom$/],
      ['Плов', /^plov asosiy taomlar .* goshtli s myasom$/],
      ["Lag'mon", /lagmon asosiy taomlar .* goshtli s myasom/],
      ['Лагман', /lagman asosiy taomlar .* goshtli s myasom/],
      ['Norin 1 porsiya', /norin asosiy taomlar .* goshtli s myasom/],
      ['Manti 5 dona', /^manti asosiy taomlar umumiy ovqatlanish shaxobchalarida tayyorlangan xamirli muchniye$/],
      ['Tandir somsa', /somsa asosiy taomlar .* xamirli muchniye/],
      ['Пельмени', /pelmeni asosiy taomlar .* xamirli muchniye/],
      ['Quymoq (omlet) 3 tuxum', /omlet asosiy taomlar .* tuxumli iz yaits/],
      ["Sho'rva 1 kosa", /^shorva umumiy ovqatlanish shaxobchalarida tayyorlangan shorvalar supi kosa$/],
      ['Mastava 1 kosa', /mastava .* shorvalar supi/],
      ["Moshxo'rda 0,5 porsiya", /moshxorda .* shorvalar supi/],
      ['Шурпа', /shurpa .* shorvalar supi/],
      ['Vinegret', /^vinegret umumiy ovqatlanish shaxobchalarida tayyorlangan salatlar salati$/],
      ['Olivye salati 1 porsiya', /olivye .* salatlar salati/],
      ['Achchiq-chuchuk salat', /chuchuk .* salatlar salati/],
      ['Gamburger', /gamburger .* fast fudlar fud/],
      ['Шаурма', /shaurma .* fast fudlar/],
      ['Qazi gazak', /gazak gazaklar .* zakuski/],
      ['Fri kartoshkasi 150 g', /fri garnirlar souslar .* garniri sousi/],
      ['Guruch garnir', /garnir garnirlar souslar/],
      ['Kapuchino 0,3 l', /kapuchino alkogolsiz ichimliklar qahva .* kofe/],
      ['Латте', /latte alkogolsiz ichimliklar qahva/],
      ['Mojito (alkogolli)', /mojito .* alkogolniye kokteyli/],
      ['Biznes-lanch', /biznes lanch kompleks ovqatlanish ratsionlari .* tushliklar obedi/],
      ['Xizmat haqi 10%', /xizmat haqi boshqa xizmatlar .* servis xizmati/],
      ['Olib ketish idishi', /olib ketish umumiy ovqatlanish shaxobchasidan .* bir martalik idish/],
      ['Banket xizmati (1 kishi)', /banket toy tadbirlari banketlar/],
      ['Tuzlama assorti', /tuzlama gazaklar sabzavotli .* zakuski ovoshniye/],
    ];
    for (const [name, re] of cases) {
      const r = row(name);
      assert.match(r.text, re, name);
      assert.deepEqual(r.groups, ['catering'], name);
    }
  });

  it('keeps the dish word: the vector stage and the relevance guard still see it', () => {
    const r = row('Palov 1 porsiya');
    assert.match(r.text, /^palov /);
    assert.deepEqual(r.added.slice(0, 2), ['asosiy', 'taomlar']);
    assert.deepEqual(r.applied, [`palov → asosiy taomlar ${CAFE} go'shtli с мясом`]);
  });

  it('lets the ingredient choose the main course after a dish word, meat by default', () => {
    assert.match(row('Tovuq kabob 1 porsiya').text, /tovuq parranda s ptitsey kabob asosiy taomlar/);
    assert.match(row('Losos steyk 200 g').text, /losos baliq s riboy steyk asosiy taomlar/);
    assert.match(row("Mol go'shtli shashlik 1 six").text, /mol s myasom goshtli shashlik asosiy taomlar/);
    assert.match(row('Lula kabob').text, /^lula kabob asosiy taomlar umumiy ovqatlanish shaxobchalarida tayyorlangan$/);
    assert.match(row('Qazi gazak').text, /qazi goshtli s myasom gazak gazaklar/);
    // Raw chicken, fish or eggs in a shop: the ingredient word fires nothing by itself.
    for (const name of ['Tovuq tuxumi', "Tovuq go'shti 1 kg", 'Losos muzlatilgan', 'Mol go’shti']) {
      assert.deepEqual(row(name).applied, [], name);
      assert.deepEqual(row(name).groups, [], name);
    }
  });

  it('reads shop words as the cafe\'s only in a cafe\'s context', () => {
    // Tea, bread, pasta, cake, ice cream, lemonade, a platter, a rental: grocery or furniture on their own.
    const shop = ["Ko'k choy 100 g", 'Tandir non', 'Boshqa makaron mahsulotlari', 'Napoleon torti', 'Qadoqlangan muzqaymoq', 'Limonad 1 l', 'Meva assorti', 'Zal uchun stol', 'Lavash 250 g', 'Kofe Jacobs 95 g', 'Sabzavot sho’rva uchun aralashma'];
    for (const name of shop) assert.deepEqual(row(name).groups, [], name);
    // A serving word in the name, a portion unit, or the row's own catering code is the context.
    assert.match(row("Ko'k choy (choynak)").text, /choy alkogolsiz ichimliklar umumiy turli xil choylar/);
    assert.match(row('Qora choy limon bilan', 'porsiya').text, /choylar/);
    assert.match(row('Tandir non', 'kg', '10202001005000001').text, /non umumiy ovqatlanish shaxobchalarida sotiladigan va mahsulotlari xleb/);
    assert.match(row("Napoleon torti 1 bo'lak").text, /torti desertlar .* qandolat mahsulotlari konditerskiye izdeliya/);
    assert.match(row('Muzqaymoq 100 g', 'dona', '10202001008000003').text, /muzqaymoq desertlar .* boshqalar prochiye/);
    assert.match(row('Limonad uy usulida 1 l').text, /limonad alkogolsiz ichimliklar boshqalar kompotlar kvas mors limonadlar/);
    assert.match(row('Kompot 1 stakan').text, /kompot alkogolsiz ichimliklar boshqalar kompotlar/);
    assert.match(row('Makaron sabzavotli 1 porsiya').text, /makaron asosiy taomlar .* sabzavot don va mahsulotlaridan iz ovoshey krup/);
    assert.match(row('Meva assorti', 'dona', '10202001008000001').text, /meva desertlar .* yongoqlar frukti orexi assorti gazaklar/);
    assert.match(row('Zal ijarasi').text, /zal ijarasi ijara xizmatlari umumiy ovqatlanish shaxobchalarida stol kabina uslugi arendi/);
    assert.match(row('Lavash tovuqli', 'dona', '10202001002000000').text, /lavash umumiy ovqatlanish shaxobchalarida tayyorlangan fast fudlar/);
    assert.match(row('Nonushta seti', 'porsiya').text, /nonushta kompleks ovqatlanish ratsionlari .* nonushtalar zavtraki/);
    // A dish word elsewhere in the name is context too.
    assert.match(row('Sabzavotli sho’rva').text, /shorvalar supi/);
    assert.match(row('Qovurilgan sazan baliq 1 porsiya').text, /qovurilgan asosiy taomlar .* sazan baliq s riboy/);
  });

  it('leaves a grocery product that names a dish alone: frozen, packaged, "for" the dish, a seasoning', () => {
    for (const name of ['Chuchvara muzlatilgan 1 kg', 'Palov uchun ziravor 50 g', 'Manti yarim tayyor 450 g', 'Shashlik uchun marinad', 'Sho’rva uchun quruq aralashma', 'Kartoshka fri muzlatilgan 2,5 kg', 'Пельмени замороженные', 'Lag’mon uchun xamir', 'Плов консервированный']) {
      const r = row(name);
      assert.deepEqual(r.applied, [], name);
      assert.deepEqual(r.groups, [], name);
    }
  });

  it('does not fire on ordinary goods or on a word that merely contains a dish name', () => {
    for (const name of ['Kartoshka', 'Sement M400', 'Coca-Cola 1.5L', 'Guruch boʻtqasi', 'Oshqozon dorisi', 'Poshshalik', 'Fitochoy', 'Choy servisi 12 buyum', 'Poyezd, vagon va konteyner ijarasi xizmatlari', 'Sous, Gril butilka 500 ml', "Qovurilgan kungaboqar urug'lari", '']) {
      const r = row(name);
      assert.deepEqual(r.groups, [], name);
      assert.equal(r.text, query(name), name);
    }
  });

  it('matches a phrase as consecutive tokens only', () => {
    assert.deepEqual(row('Olib ketish idishi').groups, ['catering']);
    assert.deepEqual(row('Idishni olib, ketish').groups, ['catering'], 'punctuation does not split the phrase');
    assert.deepEqual(row('Ketish olib').groups, [], 'the order matters');
  });

  it('fires each entry once and adds every term only once', () => {
    const r = row('Palov palov shashlik');
    assert.equal(r.applied.length, 2);
    assert.equal(new Set(r.text.split(' ')).size, r.text.split(' ').length - 1, 'only the repeated seller word repeats');
  });
});
