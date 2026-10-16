# Construction materials: general vs detailed codes — findings

Checked 2026-10-16 against the local classifier (Aug export, 438,925 live
codes). Outcome: **GENERIC_CODE is not implemented**. The brief says to build
it only if general vs detailed construction-material codes are reliably
detectable; one half of that is (general vs detailed), the other is not
(which rows are construction materials), and the rule the check would
enforce is not verified.

## What the data does show

General and detailed codes are structurally distinguishable:

- A **base (general) code** ends in `000000` (`mxik_code.isBase`); it is the
  fallback for its subposition (first 11 digits).
- **Detailed (identifying) codes** share the subposition and carry a brand,
  manufacturer or specification in the name (`brandNameUz`, `attributeNameUz`).

In the groups that hold most construction goods:

| Group | Name (classifier) | Subpositions | With a base code | Base code **and** detailed codes | Detailed codes |
|---|---|---|---|---|---|
| 025 | Tuz, oltingugurt, gips materiallari, ohak va sement | 82 | 80 | 35 | 2,003 |
| 068 | Tosh, gips, sement, asbest … materiallar | 241 | 240 | 125 | 81,778 |
| 069 | Keramik mahsulotlar | 183 | 183 | 59 | 4,348 |
| 070 | Shisha va shisha mahsulotlar | 182 | 182 | 68 | 1,083 |
| 072 | Qora metallar | 64 | 63 | 32 | 4,859 |
| 073 | Qora metallardan mahsulotlar | 111 | 111 | 76 | 53,131 |

None of these codes carries the marking flag (`isMarked` is false for all of
025, 068, 069), so the marking rule that justifies identifying codes elsewhere
does not apply.

## Why that is not enough

1. **"Construction material" is not in the data.** There is no field or
   group for it. Construction goods sit in at least 025, 044 (wood), 039
   (plastic pipes), 032 (paints), 068, 069, 070, 072, 073, 076, 083, 084 —
   and every one of those groups also holds non-construction goods (ceramic
   tableware in 069, glassware in 070, kitchen hardware in 073 …). A scope
   list would be our invention. The official construction-resources
   classifier (NKSR) would be the right source; cross-referencing it is out of
   scope (SESSION_STATE "Out of Scope").
2. **Some subpositions have no general code.** Portland cement
   (`02523002001`) has only manufacturer-specific codes
   (e.g. `02523002001001001` "Portlandsement: QIZILQUMSEMENT, II/A-I 42.5 N,
   polipropilen qop 50 kg"); there is nothing "general" to flag there.
3. **Others have an unworkable number of children.** "Yopuvchi plita"
   (`06810006002`) has one base code and 68,665 detailed ones (bridge slabs by
   drawing number and rebar consumption, e.g. "П800.124.20, расход арматуры
   213 кг/м3"). Picking "the best detailed child" needs the drawing/mark,
   which a catalogue name rarely contains; when it does, the matcher already
   ranks the identifying code first.
4. **The rule is unverified.** Gate 0 and the official guidance used so far
   treat a base code as an acceptable classification when no exact code
   applies (SESSION_STATE, Important Decisions). We found no verified source
   that requires detailed codes for construction materials on e-invoices.
   Flagging base codes as wrong would be a legal claim we cannot support.

## What would make it implementable

- A cited regulation (lex.uz) or Tax Committee statement that requires
  identifying codes for named construction-material categories, with dates.
- An authoritative scope: the NKSR codes or a list of MXIK positions it
  covers.
- Catalogue columns for the attributes that pick a child (manufacturer,
  grade/mark, standard, dimensions), mapped at upload.

With those, the check is small: for rows in scope whose code is a base code,
rank that subposition's identifying codes with the existing matcher (name +
attributes) and suggest the best one only when it clears the "Ehtimoliy"
threshold; otherwise say that a detailed code is required and list the
subposition for the user to choose from.
