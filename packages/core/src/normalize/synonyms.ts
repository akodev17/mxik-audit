// Customer words that are not the classifier's words. Different from
// abbreviations.ts: those expand a short form of the same word ("г/к" →
// "горячекатаный") and become part of the normalised name; these map a seller's
// word onto the different term the classifier uses ("арматура" → "прокат
// арматурный", "минвата" → "минеральная вата", "palov" → "asosiy taomlar,
// umumiy ovqatlanish shaxobchalarida tayyorlangan go'shtli") and touch only the
// text sent to lexical retrieval. Match keys, display names, dictionary and
// group keys never change because of a synonym.
// Pure and data-driven: adding a synonym is adding a row, with a test.
import { matchKeyOf } from './index.js';

export type SynonymKind =
  /** Fires on its own: the word nearly always means what the term says. */
  | 'anchor'
  /**
   * Fires only in context: the word is read as the term when the row shows
   * the group's context (another entry of the group fired, a context word
   * such as "porsiya", or the row's own code is in the group's classifier
   * position). "Choy" is tea leaves in a shop and a brewed cup in a cafe.
   */
  | 'contextual'
  /**
   * Refines a family once the group fired on something else: "tovuq" after
   * "kabob" says which main-course code. Never fires alone, so raw chicken
   * in a grocery list is untouched.
   */
  | 'qualifier';

export type Synonym = {
  /**
   * Words as sellers write them, any script; matched as whole folded tokens.
   * A form with a space is a phrase, matched as consecutive tokens.
   */
  forms: readonly string[];
  /** The classifier's own wording, added to the lexical query. */
  term: string;
  /**
   * Drop the seller's word instead of keeping it beside the term: for words
   * that pull the wrong codes on their own ("арматура" alone retrieves pipe
   * fittings, which the classifier also calls armatura).
   */
  replace?: true;
  /**
   * Stems that signal the word's other meaning: when any query word starts
   * with one, the entry does not apply ("арматура" next to "труба" or "кран"
   * is pipe fittings, not rebar).
   */
  unless?: readonly string[];
  /** The lexicon the entry belongs to; groups decide context (SynonymKind). */
  group?: SynonymGroup;
  /** How the entry fires; 'anchor' when absent. */
  kind?: SynonymKind;
};

export type SynonymGroup = 'catering';

/**
 * What the row has to show for a contextual entry of the group to fire: words
 * of the row name (folded tokens, measures included), as a cafe writes a
 * serving, and the classifier position the row's own code may lie in.
 */
const GROUP_CONTEXT: Record<SynonymGroup, { words: readonly string[]; codePrefix: string }> = {
  catering: {
    words: [
      // servings
      'porsiya', 'portsiya', 'porciya', 'portion', 'порция', 'kosa', 'six', 'sixda', 'boʻlak', 'bolak', 'stakan', 'stakanda',
      'choynak', 'krujka', 'chashka', 'piyola', 'grafin', 'tarelka', 'likopcha', 'kishi', 'kishiga',
      'uy usulida', 'uyda tayyorlangan', 'domashniy', 'po domashnemu', 'tayyor taom', 'tayyor ovqat',
      // places a food-service outlet rents out
      'zal', 'stol', 'kabina', 'soʻri', 'sori', 'karaoke',
      // the outlet itself
      'restoran', 'kafe', 'oshxona', 'choyxona', 'kafeteriy',
    ],
    codePrefix: '10202',
  },
};

/** Row units that read as a serving: the row is a cafe's, whatever the name says. */
const PORTION_UNIT = /^\s*\d*\s*(porsiya|portsiya|porciya|портсия|порция|порц\.?)\s*$/iu;

// The classifier's wording for the food-service menu (position 10202001). The
// official names are long; the words below are the ones that select the
// position and tell its families apart. Uzbek Latin from nameUz, one or two
// Russian words from nameRu, so a family wins on a word only it has
// ("с мясом" against "с птицей", which both say "go'shtli").
const CAFE = 'umumiy ovqatlanish shaxobchalarida tayyorlangan';
const MAIN = `asosiy taomlar ${CAFE}`;
const MAIN_MEAT = `${MAIN} go'shtli с мясом`;
const MAIN_FLOUR = `${MAIN} xamirli мучные`;
const MAIN_EGG = `${MAIN} tuxumli из яиц`;
const MAIN_VEG = `${MAIN} sabzavot, don va makaron mahsulotlaridan из овощей, круп`;
const SOUPS = `${CAFE} sho'rvalar супы`;
const SALADS = `${CAFE} salatlar салаты`;
const FAST_FOOD = `${CAFE} fast-fudlar фаст-фуд`;
const SNACKS = `gazaklar ${CAFE} закуски`;
const SNACKS_VEG = `gazaklar sabzavotli ${CAFE} закуски овощные`;
const GARNISH = `garnirlar, souslar va boshqa qo'shimchalar (topinglar) ${CAFE} гарниры соусы`;
const BREAD = 'umumiy ovqatlanish shaxobchalarida sotiladigan non va non mahsulotlari хлеб хлебные изделия';
const DESSERTS = 'desertlar umumiy ovqatlanish shaxobchalarida sotiladigan tayyorlangan десерты';
const DESSERTS_FRUIT = `${DESSERTS} meva va yong'oqlar фрукты орехи`;
const DESSERTS_SWEETS = `${DESSERTS} qandolat mahsulotlari кондитерские изделия`;
const DESSERTS_OTHER = `${DESSERTS} boshqalar прочие`;
const TEA = `alkogolsiz ichimliklar umumiy turli xil choylar ovqatlanish shaxobchalarida tayyorlangan чаи`;
const COFFEE = `alkogolsiz ichimliklar qahva va qahva tarkibli ichimliklar ${CAFE} кофе`;
const SOFT_DRINKS = `alkogolsiz ichimliklar boshqalar kompotlar kvas mors limonadlar ${CAFE} компоты лимонады`;
const COCKTAILS = `alkogolli kokteyllar ${CAFE} алкогольные коктейли`;
const MEALS = `kompleks ovqatlanish ratsionlari ${CAFE}`;

/**
 * Words that make a dish name a grocery product: frozen or packaged goods,
 * something "for" the dish ("Palov uchun ziravor"), a seasoning or a
 * concentrate. A catering anchor beside one of these does not fire.
 */
const GROCERY = [
  'muzlat', 'zamoroj', 'заморож', 'yarim', 'polufabrikat', 'полуфабрикат', 'qadoq', 'upakov', 'упаков', 'konserv', 'консерв',
  'uchun', 'dlya', 'для', 'marinad', 'маринад', 'pripra', 'приправ', 'ziravor', 'sous', 'соус', 'ketchup', 'кетчуп',
  'quruq', 'suxoy', 'сухой', 'konsentrat', 'концентрат', 'rollton', 'paket', 'пакет', 'banka', 'банка', 'chips', 'чипс', 'suxarik', 'сухарик',
];

/**
 * Counts in the comments are live classifier names (nameRu, 2026-08-20 local
 * snapshot, 438,925 codes) containing the word, and are why each entry exists.
 */
export const SYNONYMS: readonly Synonym[] = [
  // Rebar. "прокат арматурный" 314 names; "арматур" 9,892 names, 9,270 of them
  // outside the ferrous groups 072/073 (fittings, "plastik ... armatura").
  {
    forms: ['арматура', 'armatura'],
    term: 'прокат арматурный',
    replace: true,
    unless: [
      'труб', 'trub', 'quvur', 'фитинг', 'fiting', 'кран', 'kran', 'вентил', 'ventil', 'запорн', 'zaporn',
      'сантех', 'santex', 'смыв', 'smiv', 'бачк', 'bachk', 'водопровод', 'vodoprovod', 'пластик', 'plastik',
      'пластмасс', 'plastmass', 'полипропилен', 'polipropilen', 'латун', 'latun', 'муфт', 'muft',
    ],
  },
  // Angle steel: the classifier says "Угловые профили" (56 names, base code
  // 07216001002000000) and "Сталь угловая". "уголок" (203 names) and "уголки"
  // (2,564) are mostly PVC, plaster and furniture corners; adding "уголки"
  // pulled "Уголок 90,100,125" to a PVC corner in the eval (run 20).
  // Corners that are not angle steel keep their own word: "Уголок
  // перфорированный" (plaster corner, 07216001007) was pulled to a plastic
  // profile by "профили" in the re-audit of the 423-row file (2026-10-21).
  {
    forms: ['уголок'],
    term: 'угловые профили угловая сталь',
    unless: [
      'перфор', 'perfor', 'пвх', 'pvx', 'pvc', 'пласт', 'plast', 'мебел', 'mebel', 'алюмин', 'alyumin',
      'декор', 'dekor', 'штукатур', 'shtukatur', 'малярн', 'malyar', 'плинтус', 'plintus',
    ],
  },
  // Mineral wool: "минвата" 0 names, "минеральная вата" 3,496.
  { forms: ['минвата', 'minvata'], term: 'минеральная вата', replace: true },
  // Thermal insulation: "утеплитель" 531 names, "теплоизоляц" 4,117.
  { forms: ['утеплитель', 'uteplitel'], term: 'теплоизоляционные' },
  // Blocks: "газоблок" 1 name (its own base code), "газосиликатн" 6;
  // "пеноблок" 0, "пенобетонн" 14; "керамзитоблок" 0, "керамзитн… блок" 17.
  { forms: ['газоблок', 'gazoblok'], term: 'газосиликатные блоки' },
  { forms: ['пеноблок', 'penoblok'], term: 'пенобетонный блок' },
  { forms: ['керамзитоблок', 'keramzitoblok'], term: 'керамзитный блок' },
  // Polypropylene pipe: "ПП" 346 names, "PPR"/"PP" 197, "полипропиленов" 5,869
  // (Uzbek "polipropilen" 6,150). Kept here, not in abbreviations.ts, so the
  // name's match key does not change.
  { forms: ['ПП', 'ППР', 'PPR'], term: 'полипропиленовые' },

  // ------------------------------------------------------------ catering
  // The food-service menu, position 10202001 (2026-10-28, plan §7). Its codes
  // are named by family ("Asosiy taomlar, umumiy ovqatlanish shaxobchalarida
  // tayyorlangan go'shtli"), never by dish, so "Palov", "Lag'mon" or "Somsa"
  // share no word with them and only ever retrieved seasonings "for palov" and
  // frozen dumplings. Each dish word adds its family's wording. Words that a
  // shop also sells (tea, bread, ice cream) fire only in a cafe's context;
  // ingredient words refine the family after a dish word fired. Entries mapped
  // to a code are listed in docs/MATCHING_V2_PLAN.md §8.
  //
  // Main courses, meat (10202001006000001).
  {
    forms: ['palov', 'osh', 'oshi', 'plov', 'плов', 'палов', 'lagmon', 'lagman', 'лагман', 'лағмон', 'dimlama', 'димлама',
      'qovurma', 'kovurma', 'ковурма', 'norin', 'норин', 'beshbarmoq', 'beshbarmak', 'бешбармак', 'jiz', 'жиз',
      'bifshteks', 'бифштекс', 'kotlet', 'kotleta', 'котлета', 'котлеты', 'gulyash', 'гуляш', 'dolma', 'долма',
      'xasip', 'hasip', 'хасип', 'jarkoye', 'жаркое', 'otbivnaya', 'отбивная', 'ragu', 'рагу', 'azu', 'азу'],
    term: MAIN_MEAT,
    unless: GROCERY,
    group: 'catering',
  },
  // Main courses whose meat the row names separately ("Tovuq kabob", "Mol
  // go'shtli shashlik"): the family comes from the qualifier below, meat by
  // default (ties in the family's order).
  {
    forms: ['shashlik', 'shashlyk', 'шашлык', 'kabob', 'kebab', 'kabab', 'кабоб', 'кебаб', 'steyk', 'steak', 'стейк', 'grill', 'гриль',
      'lyulya', 'люля', 'fileto', 'filetto', 'nuggets', 'naggets', 'наггетсы'],
    term: MAIN,
    unless: GROCERY,
    group: 'catering',
  },
  // A dish by its generic word ("Tayyor taom", "Milliy taomlar").
  { forms: ['taom', 'taomi', 'taomlar', 'taomlari', 'блюдо', 'блюда'], term: MAIN, unless: GROCERY, group: 'catering' },
  // Cooking words that only mean a dish beside a serving ("Qovurilgan sazan
  // baliq 1 porsiya"): roasted nuts and seeds are grocery.
  { forms: ['qovurilgan', 'pishirilgan', 'dimlangan', 'qaynatilgan', 'жареный', 'жареная', 'жареное', 'тушёный', 'тушеный'], term: MAIN, group: 'catering', kind: 'contextual' },
  // Main courses, flour (10202001006000005). Frozen dumplings are grocery
  // (01905999 "Yarim tayyor un mahsulotlari"), so a packaging word blocks it.
  {
    forms: ['manti', 'manty', 'манты', 'chuchvara', 'чучвара', 'pelmeni', 'пельмени', 'vareniki', 'вареники', 'somsa', 'samsa', 'самса',
      'xonim', 'honim', 'хоним', 'tushbera', 'khinkali', 'xinkali', 'хинкали'],
    term: MAIN_FLOUR,
    unless: GROCERY,
    group: 'catering',
  },
  // Main courses, eggs (10202001006000006).
  { forms: ['omlet', 'омлет', 'quymoq', 'қуймоқ', 'yaichnitsa', 'яичница', 'glazunya', 'глазунья'], term: MAIN_EGG, unless: GROCERY, group: 'catering' },
  // Main courses, vegetables, grain and pasta (10202001006000004): pasta is
  // grocery unless served ("Makaron sabzavotli 1 porsiya").
  { forms: ['makaron', 'макароны', 'spagetti', 'спагетти', 'pasta', 'паста', 'lazanya', 'лазанья'], term: MAIN_VEG, group: 'catering', kind: 'contextual' },
  // Soups (10202001004000000). Dry soup and stock concentrates are grocery (02104).
  {
    forms: ['shorva', "sho'rva", 'shurva', 'shurpa', 'шурпа', 'шўрва', 'mastava', 'мастава', 'moshxorda', 'мошхўрда', 'moshkichiri',
      'ugra', 'угра', 'borsh', 'borshch', 'борщ', 'solyanka', 'солянка', 'xarcho', 'харчо', 'bulon', 'бульон'],
    term: SOUPS,
    unless: [...GROCERY, 'kub', 'куб', 'tayyorlash'],
    group: 'catering',
  },
  { forms: ['sup', 'supi', 'суп', 'супы'], term: SOUPS, group: 'catering', kind: 'contextual' },
  // Salads (10202001003000000): named salads on their own, the word "salat" in context.
  { forms: ['vinegret', 'винегрет', 'olivye', 'оливье', 'sezar', 'tsezar', 'цезарь', 'chuchuk', 'чучук', 'shakarob', 'шакароб', 'grecheskiy', 'греческий'], term: SALADS, unless: GROCERY, group: 'catering' },
  { forms: ['salat', 'salati', 'salatlar', 'салат', 'салаты'], term: SALADS, group: 'catering', kind: 'contextual' },
  // Fast food (10202001002000000). Lavash is also a bread in a shop.
  {
    forms: ['gamburger', 'гамбургер', 'burger', 'бургер', 'chizburger', 'cheeseburger', 'чизбургер', 'xotdog', 'hotdog', 'hot dog', 'xot dog', 'хот дог',
      'shaurma', 'shawarma', 'шаурма', 'donar', 'doner', 'донер', 'pitsa', 'pizza', 'pitstsa', 'пицца', 'sendvich', 'sandwich', 'сэндвич', 'сендвич'],
    term: FAST_FOOD,
    unless: GROCERY,
    group: 'catering',
  },
  { forms: ['lavash', 'лаваш'], term: FAST_FOOD, group: 'catering', kind: 'contextual' },
  // Snacks and platters (10202001001…): "gazak" is a cafe word; the platter
  // words are grocery too, so they need the context.
  { forms: ['gazak', 'gazaklar', 'закуска', 'закуски', 'zakuska', 'zakuski'], term: SNACKS, unless: GROCERY, group: 'catering' },
  { forms: ['tuzlama', 'tuzlamalar', 'соленья'], term: SNACKS_VEG, unless: GROCERY, group: 'catering' },
  // A platter ("Meva assorti", "Sabzavot assorti") is an appetizer plate in a cafe, a mixed pack in a shop.
  { forms: ['assorti', 'ассорти'], term: SNACKS, group: 'catering', kind: 'contextual' },
  // Garnish, sauces and toppings (10202001007000001): "fri" as in "kartoshka fri".
  { forms: ['garnir', 'garnirlar', 'гарнир', 'fri', 'фри'], term: GARNISH, unless: GROCERY, group: 'catering' },
  // Bread sold or baked by the outlet (10202001005000001): a shop's bread otherwise.
  { forms: ['non', 'нон', 'xleb', 'хлеб', 'lepyoshka', 'лепёшка', 'лепешка', 'patir', 'патир', 'bulochka', 'булочка'], term: BREAD, group: 'catering', kind: 'contextual' },
  // Desserts (10202001008…): a dessert by name on its own; fruit, cakes and ice
  // cream, which a shop sells packaged, in context.
  { forms: ['desert', 'десерт', 'desertlar', 'десерты'], term: DESSERTS, group: 'catering', kind: 'contextual' },
  { forms: ['meva', 'mevalar', 'фрукты', 'fruktoviy', 'фруктовый'], term: DESSERTS_FRUIT, group: 'catering', kind: 'contextual' },
  {
    forms: ['tort', 'torti', 'торт', 'pirojnoe', 'pirojnoye', 'пирожное', 'keks', 'кекс', 'chak chak', 'chak-chak', 'чак чак', 'halva', 'holva', 'халва', 'pechenye', 'печенье', 'shirinlik', 'shirinliklar'],
    term: DESSERTS_SWEETS,
    group: 'catering',
    kind: 'contextual',
  },
  { forms: ['muzqaymoq', 'музқаймоқ', 'morojenoye', 'мороженое'], term: DESSERTS_OTHER, group: 'catering', kind: 'contextual' },
  // Drinks the outlet makes (10202001010…, 10202001011…). Coffee-shop drinks
  // are anchors; tea, coffee, compote and lemonade are shop goods otherwise.
  { forms: ['kapuchino', 'cappuccino', 'капучино', 'latte', 'латте', 'espresso', 'эспрессо', 'amerikano', 'americano', 'американо', 'makiato', 'макиато', 'raf', 'раф', 'mokko', 'мокко'], term: COFFEE, unless: GROCERY, group: 'catering' },
  { forms: ['kofe', 'qahva', 'қаҳва', 'кофе'], term: COFFEE, group: 'catering', kind: 'contextual' },
  { forms: ['choy', 'choyi', 'chay', 'chai', 'чой', 'чай'], term: TEA, group: 'catering', kind: 'contextual' },
  { forms: ['kompot', 'компот', 'limonad', 'лимонад', 'mors', 'морс', 'kvas', 'квас'], term: SOFT_DRINKS, group: 'catering', kind: 'contextual' },
  { forms: ['mojito', 'moxito', 'mohito', 'мохито'], term: COCKTAILS, unless: GROCERY, group: 'catering' },
  { forms: ['kokteyl', 'kokteyli', 'коктейль', 'alkogolli', 'alkogolniy', 'алкогольный'], term: COCKTAILS, group: 'catering', kind: 'contextual' },
  // Set meals (10202001009…): a business lunch is a cafe's; breakfast and
  // dinner are also what a shop sells cereals for.
  { forms: ['biznes lanch', 'biznes-lanch', 'бизнес ланч', 'бизнес-ланч', 'lanch', 'ланч', 'tushlik', 'тушлик', 'obed', 'обед'], term: `${MEALS} tushliklar обеды`, unless: GROCERY, group: 'catering' },
  { forms: ['nonushta', 'нонушта', 'zavtrak', 'завтрак'], term: `${MEALS} nonushtalar завтраки`, group: 'catering', kind: 'contextual' },
  { forms: ['kechki ovqat', 'ujin', 'ужин'], term: `${MEALS} kechki ovqatlar ужины`, group: 'catering', kind: 'contextual' },
  // Services of the outlet (10202002…, 10202003…).
  { forms: ['xizmat haqi', 'servis xizmati', 'сервисный сбор'], term: 'boshqa xizmatlar umumiy ovqatlanish shaxobchalarida servis xizmati сервисного обслуживания', group: 'catering' },
  { forms: ['servis', 'сервис', 'обслуживание'], term: 'boshqa xizmatlar umumiy ovqatlanish shaxobchalarida servis xizmati сервисного обслуживания', group: 'catering', kind: 'contextual' },
  { forms: ['olib ketish', 'на вынос', 'navinos'], term: 'umumiy ovqatlanish shaxobchasidan yetkazib berish va olib ketish uchun idishlar bir martalik idish посуда на вынос', group: 'catering' },
  { forms: ['ijara', 'ijarasi', 'arenda', 'аренда'], term: 'ijara xizmatlari umumiy ovqatlanish shaxobchalarida stol kabina zal услуги аренды', group: 'catering', kind: 'contextual' },
  { forms: ['banket', 'банкет'], term: "to'y tadbirlari banketlar va boshqa tadbirlarni o'tkazish kompleks xizmatlar банкетов", group: 'catering' },
  { forms: ['keytering', 'catering', 'кейтеринг'], term: 'buyurtma asosida ovqatlanishni tashkil etish xizmatlari keytering кейтеринг', group: 'catering' },
  { forms: ['chilim', 'kalyan', 'кальян'], term: 'boshqa xizmatlar umumiy ovqatlanish shaxobchalarida chekish uchun chilim tayyorlash xizmati кальяна', group: 'catering' },
  // Ingredient words: which main course, once the row is a dish. One Uzbek
  // word the family's name has and the Russian word only it has.
  { forms: ['mol', 'qoy', "qo'y", 'goshtli', "go'shtli", 'gosht', 'goshti', 'myaso', 'мясо', 'myasnoy', 'мясной', 'govyadina', 'говядина', 'baranina', 'баранина', 'qazi', 'kazi', 'казы'], term: "go'shtli с мясом", group: 'catering', kind: 'qualifier' },
  { forms: ['tovuq', 'tovuqli', 'parranda', 'kuritsa', 'kurica', 'курица', 'kurinniy', 'куриный', 'chicken', 'ordak', 'утка'], term: 'parranda с птицей', group: 'catering', kind: 'qualifier' },
  { forms: ['baliq', 'baliqli', 'riba', 'рыба', 'ribniy', 'рыбный', 'losos', 'лосось', 'sazan', 'сазан', 'forel', 'форель', 'sudak', 'судак', 'krevetka', 'креветки', 'dengiz'], term: 'baliq с рыбой', group: 'catering', kind: 'qualifier' },
  { forms: ['tuxum', 'tuxumli', 'yaytso', 'яйцо', 'яйца'], term: 'tuxumli из яиц', group: 'catering', kind: 'qualifier' },
  { forms: ['sabzavot', 'sabzavotli', 'ovoshnoy', 'овощной', 'ovoshi', 'овощи'], term: 'sabzavot из овощей', group: 'catering', kind: 'qualifier' },
];

type Compiled = {
  forms: readonly string[][]; term: string[]; replace: boolean; unless: string[]; label: string;
  group: SynonymGroup | null; kind: SynonymKind;
};

export const SYNONYM_GROUPS: readonly SynonymGroup[] = ['catering'];
export const SYNONYM_KINDS: readonly SynonymKind[] = ['anchor', 'contextual', 'qualifier'];

function compile(entries: readonly Synonym[]): Compiled[] {
  return entries.map((s) => {
    const term = matchKeyOf(s.term).split(' ').filter(Boolean);
    const forms = s.forms.map((f) => matchKeyOf(f).split(' ').filter(Boolean)).filter((f) => f.length > 0);
    return {
      forms,
      term,
      replace: s.replace === true,
      unless: (s.unless ?? []).map(matchKeyOf).filter(Boolean),
      label: `${s.forms[0] ?? ''} → ${s.term}`,
      group: s.group ?? null,
      kind: s.kind ?? 'anchor',
    };
  });
}

const COMPILED: readonly Compiled[] = compile(SYNONYMS);

/**
 * Entries learned outside this file (the admin lexicon, normalize/lexicon.ts),
 * applied after the file's own so the hand-written table stays the baseline.
 * Empty until a lexicon is installed, which keeps every existing caller as it was.
 */
let EXTENSION: readonly Compiled[] = [];

/** Replaces the learned entries (none = the file's table alone). */
export function setSynonymExtension(entries: readonly Synonym[]): void {
  EXTENSION = compile(entries);
}

/** How many learned entries are installed, for status lines. */
export function synonymExtensionSize(): number {
  return EXTENSION.length;
}

function table(): readonly Compiled[] {
  return EXTENSION.length === 0 ? COMPILED : [...COMPILED, ...EXTENSION];
}

const CONTEXT_WORDS: Record<SynonymGroup, readonly string[][]> = {
  catering: GROUP_CONTEXT.catering.words.map((w) => matchKeyOf(w).split(' ').filter(Boolean)),
};

export type SynonymResult = {
  /** The lexical query with classifier terms added (or substituted). */
  text: string;
  /** Entries that fired, as the table writes them ("арматура → прокат арматурный"), for the evidence. */
  applied: string[];
  /** Folded classifier words the entries put into the query. */
  added: string[];
  /** Groups an entry of which fired: the lexicons the row was read with. */
  groups: SynonymGroup[];
};

/**
 * What the row shows besides the query, for contextual entries: the name as
 * written (its measures and serving words are stripped from the query), the
 * unit, and the row's own code.
 */
export type SynonymRow = {
  name?: string | null;
  unit?: string | null;
  existingMxik?: string | null;
};

/** Whether `phrase` occurs as consecutive tokens; the index where, or -1. */
function phraseAt(tokens: readonly string[], phrase: readonly string[]): number {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return i;
  }
  return -1;
}

/** True when the row shows the group's context, independent of the lexicon. */
export function hasGroupContext(group: SynonymGroup, row: SynonymRow | undefined): boolean {
  if (!row) return false;
  const code = (row.existingMxik ?? '').replace(/\D/g, '');
  if (code && code.startsWith(GROUP_CONTEXT[group].codePrefix)) return true;
  if (row.unit && group === 'catering' && PORTION_UNIT.test(row.unit)) return true;
  const tokens = matchKeyOf(row.name ?? '').split(' ').filter(Boolean);
  return tokens.length > 0 && CONTEXT_WORDS[group].some((w) => phraseAt(tokens, w) >= 0);
}

type Firing = { entry: Compiled; at: number; length: number };

/**
 * Applies the table to a folded lexical query (space-separated match-key
 * tokens). Each entry fires at most once; a term already in the query is not
 * repeated. `row` is what contextual and qualifier entries look at.
 */
export function applySynonyms(query: string, row?: SynonymRow): SynonymResult {
  const tokens = query.split(/\s+/).filter(Boolean);
  const matches = (entry: Compiled): Firing | null => {
    for (const form of entry.forms) {
      const at = phraseAt(tokens, form);
      if (at < 0) continue;
      const others = tokens.filter((_, i) => i < at || i >= at + form.length);
      if (entry.unless.some((u) => others.some((t) => t.startsWith(u)))) return null;
      return { entry, at, length: form.length };
    }
    return null;
  };
  // Anchors first; they and the row decide whether the group's contextual
  // entries fire, and those together whether its qualifiers do.
  const firings: Firing[] = [];
  const active = new Set<SynonymGroup>();
  const entries = table();
  for (const kind of ['anchor', 'contextual', 'qualifier'] as const) {
    for (const entry of entries) {
      if (entry.kind !== kind) continue;
      if (kind === 'contextual' && (!entry.group || !(active.has(entry.group) || hasGroupContext(entry.group, row)))) continue;
      if (kind === 'qualifier' && (!entry.group || !active.has(entry.group))) continue;
      const firing = matches(entry);
      if (!firing) continue;
      firings.push(firing);
      if (entry.group) active.add(entry.group);
    }
  }
  firings.sort((a, b) => a.at - b.at);

  const applied: string[] = [];
  const added: string[] = [];
  const out: string[] = [];
  const consumed = new Set<number>();
  const after = new Map<number, Firing[]>();
  for (const f of firings) {
    applied.push(f.entry.label);
    if (f.entry.replace) for (let i = f.at; i < f.at + f.length; i++) consumed.add(i);
    const end = f.at + f.length - 1;
    after.set(end, [...(after.get(end) ?? []), f]);
  }
  tokens.forEach((token, i) => {
    if (!consumed.has(i)) out.push(token);
    for (const f of after.get(i) ?? []) {
      for (const word of f.entry.term) {
        if (tokens.includes(word) || out.includes(word)) continue;
        out.push(word);
        added.push(word);
      }
    }
  });
  const groups = [...active];
  return { text: out.join(' '), applied, added, groups };
}
