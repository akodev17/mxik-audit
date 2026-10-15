import { PORTAL_CHECKED, PORTAL_EXAMPLES } from './data';

// Three dated portal searches: right tool for one code, wrong tool for a file.
export function PortalExamples() {
  return (
    <div>
      <h3 className="text-[24px] sm:text-[28px]">Portal bitta kodni qidirish uchun. Biz butun katalogni tekshiramiz.</h3>
      <p className="mt-3 max-w-[62ch] text-lp-muted">
        Rasmiy tasniflagich yagona manba, biz ham uning eksportidan foydalanamiz. Lekin portal
        qidiruvi soʻrov qanday yozilganiga sezgir. Natijalar {PORTAL_CHECKED} holatiga.
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {PORTAL_EXAMPLES.map((e) => (
          <li key={e.query} className="border border-lp-line p-5">
            <p className="text-[15px] text-lp-muted">Qidiruv: {e.note}</p>
            <p className="mt-2 border border-lp-line-strong bg-lp-base px-3 py-2 text-[18px] font-medium">{e.query}</p>
            <p className="mt-3 flex items-start gap-2 text-[16px]">
              <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 bg-lp-risk" />
              <span>{e.result}</span>
            </p>
            {e.contrast ? (
              <p className="mt-2 flex items-start gap-2 text-[16px] text-lp-muted">
                <span aria-hidden="true" className="mt-2 h-2.5 w-2.5 shrink-0 bg-lp-ok" />
                <span>«{e.contrast.query}» deb yozilsa: {e.contrast.result}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
