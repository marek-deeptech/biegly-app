// Deterministyczny montaż opinii z subanaliz.
//
// Zasada: LLM NIE LICZY. Wszystkie liczby pochodzą z silnika faktów (tabela
// `metrics`); proza jest szablonowa. Opinia montuje się z ZATWIERDZONYCH
// subanaliz (tabela `subanalyses`); rozdział bez zapisanej subanalizy pokazuje
// podgląd „na żywo" oznaczony jako szkic.

export type Conf = "grounded" | "review" | "todo";
export type Para = { text: string; conf: Conf };
export type OpTable = { caption: string; head: string[]; rows: string[][] };
export type Chapter = {
  no: string;
  title: string;
  status: "ready" | "draft" | "todo";
  source?: string;
  paras: Para[];
  table?: OpTable;
  findings?: Para[];
  attachments?: string[];
};
export type Opinion = {
  caseName: string;
  signature: string | null;
  expert: string;
  generatedAt: string;
  legalBasis: string[];
  chapters: Chapter[];
};

// Wynik generatora subanalizy (do zapisania w `subanalyses`).
export type SubResult = {
  kind: string;
  chapterNo: string;
  title: string;
  bodyMd: string;
  data: { table: OpTable | null; findings: string[]; legalRefs: string[] };
};
export type QuantResult = SubResult;

// Zapisana subanaliza (z tabeli `subanalyses`).
export type StoredSub = {
  kind: string;
  chapter_no: string;
  title: string;
  status: string; // 'szkic' | 'zatwierdzona'
  body_md: string;
  data: { table?: OpTable | null; findings?: string[]; legalRefs?: string[] } | null;
};

type Metric = {
  key: string;
  value: number | null;
  unit: string | null;
  session_day: string | null;
};
type Doc = { rel_path: string; provenance: string | null; doc_type?: string | null };

const EXPERT = "mgr Krzysztof Michrowski — biegły sądowy";
const LEGAL_BASIS = [
  "art. 12 rozporządzenia MAR (UE) 596/2014 — definicja manipulacji na rynku",
  "rozporządzenie delegowane (UE) 2016/522, załącznik II — wskaźniki manipulacji",
  "art. 183 ustawy z dnia 29 lipca 2005 r. o obrocie instrumentami finansowymi",
];

function plnum(n: number | null | undefined, unit?: string | null): string {
  if (n == null) return "—";
  const s = n.toLocaleString("pl-PL");
  if (unit === "%") return `${s}%`;
  return unit ? `${s} ${unit}` : s;
}
function basename(p: string): string {
  return p.split("/").pop() || p;
}
function splitParas(md: string): string[] {
  return md.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
}

// ── Generator subanalizy ilościowej — deterministyczny, z metryk silnika ──
export function buildQuantitativeSubanaliza(metrics: Metric[]): QuantResult | null {
  if (!metrics.length) return null;
  const find = (k: string) => metrics.find((m) => m.key === k) ?? null;
  const peak = (prefix: string) =>
    metrics
      .filter((m) => m.key.startsWith(prefix))
      .reduce<Metric | null>((a, b) => ((b.value ?? -1) > (a?.value ?? -1) ? b : a), null);
  const days = [
    ...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string)),
  ].sort();

  const groupShare = find("group_turnover_share");
  const nTx = find("totals_transactions");
  const valTx = find("totals_value");
  const volTx = find("totals_volume");
  const washPeak = peak("wash_");
  const cancelPeak = peak("cancel_");

  const paras: string[] = [
    `Na podstawie danych transakcyjnych z systemu UTP (udostępnionych przez Giełdę Papierów ` +
      `Wartościowych w Warszawie) przeanalizowano ${plnum(nTx?.value)} transakcji o łącznej ` +
      `wartości ${plnum(valTx?.value, "zł")} i wolumenie ${plnum(volTx?.value, "szt")}. ` +
      `Udział rachunków powiązanych (dalej „Grupa") w wartości obrotu instrumentem wyniósł ` +
      `${plnum(groupShare?.value, "%")}.`,
  ];
  if (washPeak) {
    paras.push(
      `W analizowanych sesjach stwierdzono transakcje wzajemne (wash trades), w których po obu ` +
        `stronach występowały rachunki Grupy. Udział takich transakcji w wolumenie sesji sięgał ` +
        `${plnum(washPeak.value, "%")} (sesja ${washPeak.session_day}). Transakcje te nie powodują ` +
        `zmiany rzeczywistego właściciela ekonomicznego instrumentu i stanowią pozorny obrót w ` +
        `rozumieniu art. 12 ust. 1 lit. a MAR oraz załącznika II do rozporządzenia 2016/522.`,
    );
  }
  if (cancelPeak) {
    paras.push(
      `Udział anulowanych zleceń kupna składanych przez rachunki Grupy sięgał ` +
        `${plnum(cancelPeak.value, "%")} (sesja ${cancelPeak.session_day}). Składanie i niezwłoczne ` +
        `anulowanie zleceń bez zamiaru ich realizacji odpowiada technikom layering i spoofing, ` +
        `wprowadzającym uczestników rynku w błąd co do rzeczywistego popytu i podaży.`,
    );
  }

  const table: OpTable | null = days.length
    ? {
        caption:
          "Tabela 1. Udział transakcji wzajemnych i anulacji kupna Grupy w poszczególnych sesjach",
        head: ["Sesja", "Wash-trades (% wolumenu)", "Anulacje kupna (%)"],
        rows: days.map((d) => {
          const w = metrics.find((m) => m.session_day === d && m.key.startsWith("wash_"));
          const c = metrics.find((m) => m.session_day === d && m.key.startsWith("cancel_"));
          return [d, w ? plnum(w.value, "%") : "—", c ? plnum(c.value, "%") : "—"];
        }),
      }
    : null;

  const findings: string[] = [];
  if (groupShare?.value != null)
    findings.push(
      `Udział Grupy w wartości obrotu (${plnum(groupShare.value, "%")}) wskazuje na zdolność ` +
        `wywierania dominującego wpływu na kształtowanie kursu instrumentu.`,
    );
  if (washPeak?.value != null)
    findings.push(
      `Transakcje wzajemne (do ${plnum(washPeak.value, "%")} wolumenu sesji) generowały pozorny ` +
        `obrót, mogący wprowadzać w błąd co do płynności instrumentu.`,
    );
  if (cancelPeak?.value != null)
    findings.push(
      `Wysoki udział anulacji zleceń kupna (do ${plnum(cancelPeak.value, "%")}) wskazuje na ` +
        `działania zmierzające do wywołania mylnego wyobrażenia o popycie.`,
    );

  return {
    kind: "ilosciowa",
    chapterNo: "IV.3",
    title: "Analiza ilościowa aktywności Grupy",
    bodyMd: paras.join("\n\n"),
    data: { table, findings, legalRefs: ["art. 12 MAR", "RD 2016/522, zał. II"] },
  };
}

// Dynamika kursu z notowania-engine (lib/quotes/parse.ts).
export type QuoteDyn = {
  from: string;
  to: string;
  start: number;
  end: number;
  maxClose: number;
  peakDate: string;
  changeStartMaxPct: number;
  changeStartEndPct: number;
};

// ── Generator subanalizy eko-fin — szkielet rozdz. IV.1 z faktami z inwentarza ──
// Otoczenie rynkowe jest częściowo jakościowe: fakty z inwentarza akt oraz
// policzona dynamika kursu są ugruntowane, a ocena fundamentalna pozostaje do
// uzupełnienia przez biegłego.
export function buildEkofinSubanaliza(
  metrics: Metric[],
  documents: Doc[],
  quotes?: QuoteDyn | null,
): SubResult {
  const days = [
    ...new Set(metrics.filter((m) => m.session_day).map((m) => m.session_day as string)),
  ].sort();
  const period = days.length ? `od ${days[0]} do ${days[days.length - 1]}` : "[okres do uzupełnienia]";
  const byType = (t: string) => documents.filter((d) => d.doc_type === t);
  const espi = byType("RAPORT_ESPI_EBI");
  const fin = byType("SPRAWOZDANIE_FIN");
  const notow = byType("NOTOWANIA_REF");
  const stanp = byType("ZAWIAD_STAN_POSIADANIA");
  const lst = (ds: Doc[], n = 15) =>
    ds.slice(0, n).map((d) => "• " + basename(d.rel_path)).join("\n") +
    (ds.length > n ? `\n• … (+${ds.length - n})` : "");

  const sec: string[] = [];
  sec.push(
    `Celem niniejszej analizy jest ustalenie, czy zmiana kursu instrumentu w okresie ${period} ` +
      `znajduje uzasadnienie w sytuacji ekonomiczno-finansowej spółki oraz w publicznie dostępnych ` +
      `informacjach, czy też ma charakter oderwany od fundamentów — co wzmacniałoby tezę o manipulacji.`,
  );
  sec.push(
    `Dynamika kursu i wolumenu. ` +
      (quotes
        ? `W okresie od ${quotes.from} do ${quotes.to} kurs zmienił się z ${plnum(quotes.start, "zł")} ` +
          `(początek) do maksymalnie ${plnum(quotes.maxClose, "zł")} w dniu ${quotes.peakDate} — wzrost ` +
          `o ${plnum(quotes.changeStartMaxPct, "%")}. Kurs na koniec okresu: ${plnum(quotes.end, "zł")} ` +
          `(${plnum(quotes.changeStartEndPct, "%")} względem początku). ` +
          `[Do uzupełnienia: czy skala zmiany kursu znajduje uzasadnienie w fundamentach.]`
        : (notow.length
            ? `W aktach znajdują się dane notowań (${notow.length}) — wygeneruj subanalizę, aby policzyć ` +
              `kurs początkowy, maksymalny i skalę wzrostu. `
            : `Brak w aktach danych notowań do wyznaczenia dynamiki kursu. `) +
          `[Do uzupełnienia: kurs początkowy, kurs maksymalny, procentowa zmiana, data szczytu.]`),
  );
  sec.push(
    `Sytuacja finansowa spółki. ` +
      (fin.length
        ? `W aktach zidentyfikowano ${fin.length} dokument(ów) finansowych (sprawozdania / plany rozwoju):\n${lst(fin)}\n`
        : `Brak w aktach sprawozdań finansowych. `) +
      `[Do uzupełnienia: czy wyniki i perspektywy spółki uzasadniają zaobserwowaną zmianę kursu.]`,
  );
  sec.push(
    `Informacje publiczne (raporty ESPI/EBI). ` +
      (espi.length
        ? `W okresie objętym analizą spółka publikowała raporty bieżące/okresowe. W aktach ` +
          `zidentyfikowano ${espi.length} raport(ów):\n${lst(espi)}\n`
        : `Brak w aktach raportów ESPI/EBI. `) +
      `[Do uzupełnienia: czy którykolwiek raport miał charakter cenotwórczy i tłumaczy ruch kursu.]`,
  );
  if (stanp.length)
    sec.push(
      `Zmiany stanu posiadania. Zidentyfikowano ${stanp.length} zawiadomienie(a) o zmianie stanu ` +
        `posiadania — istotne dla oceny przepływu pakietów i powiązania z dynamiką kursu.`,
    );
  sec.push(
    `Ocena. [Do uzupełnienia przez biegłego: czy fundamenty i informacje publiczne uzasadniają ` +
      `zaobserwowaną dynamikę kursu. Brak takiego uzasadnienia wzmacnia tezę o oderwaniu ceny od ` +
      `wartości i o manipulacji instrumentem finansowym.]`,
  );

  const findings: string[] = [];
  if (quotes)
    findings.push(
      `Kurs wzrósł o ${plnum(quotes.changeStartMaxPct, "%")} (z ${plnum(quotes.start, "zł")} do ` +
        `${plnum(quotes.maxClose, "zł")}, szczyt ${quotes.peakDate}).`,
    );
  findings.push(
    `W aktach zidentyfikowano: ${espi.length} raport(ów) ESPI/EBI, ${fin.length} dokument(ów) ` +
      `finansowych, ${notow.length} zbiór(ów) notowań, ${stanp.length} zawiadomień o stanie posiadania.`,
  );

  return {
    kind: "ekofin",
    chapterNo: "IV.1",
    title: "Analiza ekonomiczno-finansowa i otoczenie rynkowe",
    bodyMd: sec.join("\n\n"),
    data: {
      table: null,
      findings,
      legalRefs: ["art. 7 MAR (informacja poufna)", "art. 17 MAR (raporty bieżące)"],
    },
  };
}

const SUB_LABEL: Record<string, string> = {
  ilosciowa: "ilościowa UTP (silnik faktów)",
  ekofin: "ekonomiczno-finansowa i otoczenie",
  porozumienie: "porozumienie (IP / OSINT)",
  otc: "obrót pozagiełdowy / motyw",
};

// Rozdział opinii z zapisanej subanalizy (zatwierdzona → grounded/ready).
function chapterFromStored(s: StoredSub): Chapter {
  const conf: Conf = s.status === "zatwierdzona" ? "grounded" : "review";
  return {
    no: s.chapter_no,
    title: s.title,
    status: s.status === "zatwierdzona" ? "ready" : "draft",
    source:
      `Subanaliza: ${SUB_LABEL[s.kind] ?? s.kind}` +
      (s.status === "zatwierdzona" ? " · zatwierdzona" : " · szkic"),
    paras: splitParas(s.body_md).map((t) => ({ text: t, conf })),
    table: s.data?.table ?? undefined,
    findings: (s.data?.findings ?? []).map((t) => ({ text: t, conf: "grounded" as Conf })),
  };
}

// Podgląd subanalizy ilościowej „na żywo" (gdy nie zapisano jej jeszcze w bazie).
function liveQuantChapter(metrics: Metric[]): Chapter | null {
  const q = buildQuantitativeSubanaliza(metrics);
  if (!q) return null;
  return {
    no: q.chapterNo,
    title: q.title,
    status: "draft",
    source: "Subanaliza: ilościowa UTP (niezapisana — wygeneruj, aby edytować)",
    paras: splitParas(q.bodyMd).map((t) => ({ text: t, conf: "review" as Conf })),
    table: q.data.table ?? undefined,
    findings: q.data.findings.map((t) => ({ text: t, conf: "grounded" as Conf })),
  };
}

export function buildOpinion(
  caseRow: { name: string; signature: string | null },
  metrics: Metric[],
  documents: Doc[],
  stored: StoredSub[] = [],
): Opinion {
  const inputDocs = documents.filter((d) => d.provenance !== "wyjście");

  // Rozdział IV — blok subanaliz (IV.x): zapisane + ewentualny podgląd ilościowy.
  const ivChapters: Chapter[] = stored
    .filter((s) => s.chapter_no.startsWith("IV"))
    .map(chapterFromStored);
  if (!stored.some((s) => s.kind === "ilosciowa")) {
    const live = liveQuantChapter(metrics);
    if (live) ivChapters.push(live);
  }
  ivChapters.sort((a, b) => a.no.localeCompare(b.no, "pl"));
  if (ivChapters.length === 0) {
    ivChapters.push({
      no: "IV",
      title: "Analiza",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text: "Brak subanaliz dla rozdziału IV — wygeneruj subanalizę ilościową lub eko-fin.",
        },
      ],
    });
  }
  const ivTable = ivChapters.find((c) => c.table)?.table ?? null;

  const chapters: Chapter[] = [
    {
      no: "I",
      title: "Przedmiot opinii i podstawa prawna",
      status: "draft",
      paras: [
        {
          conf: "review",
          text:
            `Przedmiotem opinii jest ocena, czy w obrocie instrumentem finansowym objętym sprawą` +
            `${caseRow.signature ? ` (sygn. ${caseRow.signature})` : ""} doszło do manipulacji w ` +
            `rozumieniu art. 12 MAR, a jeżeli tak — w jaki sposób i przez kogo.`,
        },
        {
          conf: "todo",
          text:
            "Do uzupełnienia: oznaczenie spółki i instrumentu, okres objęty analizą oraz pytania " +
            "organu zgodnie z treścią postanowienia o powołaniu biegłego.",
        },
      ],
    },
    {
      no: "II",
      title: "Wnioski",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Sekcja generowana na etapie montażu po zatwierdzeniu subanaliz — synteza odpowiedzi na " +
            "pytania postanowienia, z rozdzieleniem ustaleń faktycznych od ocen zastrzeżonych dla sądu.",
        },
      ],
    },
    {
      no: "III",
      title: "Wstęp teoretyczny — techniki manipulacji",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Warsztat teoretyczno-prawny (część III): definicje i wskaźniki manipulacji wg MAR i RD " +
            "2016/522 — moduł wielokrotnego użytku, do podłączenia.",
        },
      ],
    },
    ...ivChapters,
    {
      no: "V",
      title: "Podsumowanie",
      status: "todo",
      paras: [
        {
          conf: "todo",
          text:
            "Podsumowanie generowane na etapie montażu (po subanalizie eko-fin, ESPI/EBI, porozumienia " +
            "i OTC/motywu).",
        },
      ],
    },
    {
      no: "VI",
      title: "Spis tabel i wykaz załączników",
      status: ivTable || inputDocs.length ? "ready" : "todo",
      paras: [
        {
          conf: ivTable ? "grounded" : "todo",
          text: ivTable
            ? "Tabela 1 — udział transakcji wzajemnych i anulacji kupna Grupy w poszczególnych sesjach."
            : "Spis tabel zostanie uzupełniony po wykonaniu analiz.",
        },
      ],
      attachments: inputDocs.slice(0, 300).map((d) => basename(d.rel_path)),
    },
  ];

  return {
    caseName: caseRow.name,
    signature: caseRow.signature,
    expert: EXPERT,
    generatedAt: new Date().toISOString(),
    legalBasis: LEGAL_BASIS,
    chapters,
  };
}
