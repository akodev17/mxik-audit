# Tax-privilege (imtiyoz) data — what the classifier provides

Checked 2026-10-16 against the local classifier (Aug export, 438,925 codes) and
the portal's public reference endpoint.

## What exists

| Source | Content |
|---|---|
| Export column O "IMTIYOZ ID" → `mxik_code.taxPrivilegeIds` | **37,530** codes carry at least one id; **67** distinct ids. Id `0` appears on 64 codes and means none. |
| `GET /api/cls-api/integration-mxik/references/lgota` (public, found in Gate 0) | **202** privileges: `id`, wording (`nameLatn`, `nameRu`, `nameUz`), legal document (`docNum`, `docDate`, `docNameLatn`). Loaded into `tax_privilege` by `npm run privileges:fetch` (also run by `classifier:update`). |

The wording names the legal basis, e.g. id `102870`: "(SK 243-m.) 13-band.
dori vositalarini, veterinariya dori vositalarini, tibbiyot va veterinariya
uchun moʻljallangan buyumlarni" — the VAT exemption for medicines, linked to
37,014 codes (98.6% of all linked codes; 36,696 of them in the pharmaceutical
group).

So the data does link codes to privileges, and feature K is implemented
(no disabled flag needed):

- `PRIVILEGE_CODE` — the row's code (an accepted correction, else the file's)
  is privilege-linked. Informational; **medium** when the same code is also a
  pending MISMATCH (the product name does not fit the code, so a privilege
  claimed through it is doubtful).
- `PRIVILEGE_OPPORTUNITY` — the suggested code is privilege-linked and the
  row's code is not. Always informational; it never changes a code by itself.

Both run after every audit (`src/lib/privileges.ts`), replace only pending
privilege findings, and never count as risk unless severity is medium.

## What is missing — do not infer it

1. **Validity period.** No field says whether a privilege is in force. At
   least 8 reference texts are time-bound in their wording (e.g. "2021 yil 10
   oktyabrdan 2022 yil 31 dekabrga qadar …"), and the classifier still links
   codes to them. The app shows the wording and tells the user to check the
   conditions and period; it never says a privilege applies.
2. **Conditions.** Many privileges depend on who sells, to whom, or under
   which programme (e.g. operators of a production-sharing agreement). None of
   that is in the data.
3. **Which tax.** The wording usually names the Tax Code article (243 = VAT
   exemptions, 483 = turnover tax, …) but there is no structured "tax type"
   field; nothing is computed from it.
4. **One id missing from the reference:** `103312` is used by codes but not
   returned by the endpoint; it is shown as "imtiyoz ID 103312".
5. **History.** The export is a snapshot; when a link is added or removed
   only a later import shows it (the classifier diff does not track privilege
   changes yet).

A tax adviser should confirm the wording shown to users before the privilege
findings are promoted in sales material.
