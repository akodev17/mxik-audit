# OData fixtures: where each one comes from

The OData client (`../../odata.ts`, `../../transfer.ts`) has never reached a real
«1С:Бухгалтерия для Узбекистана» base. These fixtures are the closest substitute: responses and
request bodies published by 1C, by a 1C hosting company reprinting the 1C administrator guide, and
by practitioners who ran them against real bases. Research note: `tmp/real-docs/onec/RESEARCH.md`
§5 and §7 (gitignored; the URLs below are the sources).

| File | Source | What was changed |
|---|---|---|
| `list-fizlica-top2.json` | 1C:Fresh official guide «Интерфейс OData», §6.2 (`GET Catalog_ФизическиеЛица?$format=json&$top=2`), https://1cfresh.com/articles/data_odata | The demo persons' names replaced by «Физлицо Первое/Второе» (private persons). Keys, `odata.metadata`, `DataVersion`, empty-GUID references kept. |
| `list-nomenklatura-filter-select.json` | same guide, `$filter=startswith(...)&$select=НаименованиеПолное,Артикул` | Verbatim (product names). |
| `list-sotrudniki-expand.json` | same guide, §6.2.7 `$expand=Физлицо` | Person names replaced as above. |
| `list-fizlica-inlinecount.json` | same guide, §6.2.5 `$inlinecount=allpages` — shows `"odata.count": "28"` as a **string** | Person names replaced. |
| `post-201-fizlico.json` | same guide, §6.3.5 (the answer to `POST Catalog_ФизическиеЛица?$format=json`) | Name replaced; the sample ИНН is the guide's demo value. |
| `error-code-9.xml` | 42clouds «Интерфейс OData: ошибочные ситуации» (reprint of the 1C guide), https://42clouds.com/ru-ru/manuals/interfeys-odata-oshibochnye-situatsii/ | Verbatim XML envelope. |
| `error-codes.json` | same page: the table of internal codes 0–20 | Transcribed. |
| `mista-post-body.json` | mista.ru topic 828664 (03.12.18), «oData, REST и создание документа, заполнение табличной части», https://www.mista.ru/topic/828664 — the body the author found **working**: no `Ref_Key` on the document or the rows | A trailing comma after the rows array removed so it parses. |
| `mista-post-row-keys.json` | same thread (15.11.18): the body that created the document **with an empty tabular part** because each row carried `Ref_Key` | The `{"value":[…]}` wrapper removed. |
| `patch-tabular-part.json` | 42clouds «Интерфейс OData: примеры типовых операций», https://42clouds.com/ru-ru/manuals/interfeys-odata-primery-tipovykh-operatsiy/ — PATCH resending the whole tabular part with `@odata.type` | A missing comma added; the page's typographic spaces in dates restored to `-`. |
| `fake-server.ts` | Behaviour taken from the sources above: 201 + `Location`; `Post()` → 200 with an empty body, 500 when the application refuses (1C:Fresh guide §6.5.1); `DELETE` removes physically (§6.3.6); 401 on record-level restrictions without `allowedOnly=true` (code 20); 403 «Объект не включен в состав стандартного интерфейса OData» (confaster.ru/blog/oshibka-403-odata-1s/); code 13 for rows written to `Document_X_Товары` (mista, 42clouds); PATCH with `If-Match` answering 412 on a stale `DataVersion`. | — |
| `$metadata` (`metadataXml(BP_UZ_SPEC)` in `fake-server.ts`) | **Constructed.** No `$metadata` of a real Uzbek base is public. Shape from the documented conventions: namespace `StandardODATA`, row types `<Set>_<Part>_RowType` (42clouds PATCH sample), tabular parts as their own entity sets (`Catalog_Организации_КонтактнаяИнформация`, 1C:Fresh §6.4.2), references as `<Name>_Key`, composite ones as `<Name>` + `<Name>_Type`. Entity and attribute names: the typical BP 3.0 names listed in research note §5.2 and the 1C_integration project (`Document_ПоступлениеТоваровУслуг`). | Replace with a real base's `$metadata` once the owner has one (see the plan's S4 results). |
