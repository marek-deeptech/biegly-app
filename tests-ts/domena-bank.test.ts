import { describe, expect, it } from "vitest";

import { packDla, wymaganeTypy, WSZYSTKIE_PAKIETY } from "@/lib/domain";
import { przepisyAnachroniczne, przepisyNaDzien } from "@/lib/domain/prawo-bankowe";
import { classifyPath } from "@/lib/intake/classify";
import { rdzenDokumentu, doOcr, buildCompleteness } from "@/lib/intake/completeness";
import { buildOpinionBank } from "@/lib/opinion/build-bank";

// Nazwy plików pochodzą z realnych akt PO III Ds 84.2020. Są WBUDOWANE, nie czytane
// z dysku: golden testy silnika padły już raz, gdy katalog źródłowy uporządkowano.
const AKTA_MBR = [
  "postanowienie o powołaniu biegłego.pdf",
  "Skany akt 84.2020/uchwała metodyka limitow.pdf",
  "Skany akt 84.2020/protokoły KZAiP.pdf",
  "Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf",
  "Skany akt 84.2020/audyt wew.pdf",
  "Skany akt 84.2020/BION MBR.pdf",
  "załączniki/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf",
  "załączniki/ZAŁĄCZNIK 6 - SF-GLITNIR-2007.pdf",
  "CDS default.xlsx",
  "CBI 2008 enska.pdf",
  "Icelandic whispers shake faith in boom _ Financial Times.pdf",
];

describe("klasyfikacja akt bankowych", () => {
  it.each([
    // Raport sektorowy nadzoru, mimo skrótu KNB w nazwie — nie źródło prawa.
    ["KNB bankispoldzielcze 2006.pdf", "NADZOR_KNF"],
    // Uchwała KNB to JEST źródło prawa.
    ["Uchwały KNB 2007/Uchwała nr 1 _2007 Komisji Nadzoru Bankowego.pdf", "AKT_PRAWNY"],
    // Regulacja DOTYCZĄCA ratingów, nie komunikat agencji.
    ["rozporządzenie - rating.pdf", "AKT_PRAWNY"],
    ["Skany akt 84.2020/uchwała metodyka limitow.pdf", "METODYKA_LIMITOW"],
    ["Skany akt 84.2020/uchwała kompetencje do podejmowania dec.pdf", "UCHWALA_WEWNETRZNA"],
    ["załączniki/ZAŁĄCZNIK 5 - SF-GLITNIR-2008-2q.pdf", "SPRAWOZDANIE_BANK"],
    ["CBI 2008 enska.pdf", "RAPORT_BANK_CENTRALNY"],
    ["CDS default.xlsx", "DANE_RYNKOWE_SZEREG"],
    ["RACHUNEK I KARTA BIEGŁEGO PROKURATURA MBR.doc", "RACHUNEK_BIEGLEGO"],
    // Wykres sporządzony do opinii — wyjście, nie dowód. Reguła grafiki musi
    // wyprzedzać merytoryczne, bo podciąg „cds" pasowałby wcześniej.
    ["grafika/CDS Glitnir.jpg", "GRAFIKA"],
    // Podkreślenia zamiast spacji — dopasowanie po spłaszczeniu separatorów.
    ["Domanska_Szaruga_Ryzyko_kredytowe_w_swietle NUK.pdf", "LITERATURA"],
  ])("%s → %s", (plik, oczekiwany) => {
    expect(classifyPath(plik, "ryzyko_bankowe")).toBe(oczekiwany);
  });

  it.each([
    ["HUBTECH/Transakcje_i_Zlecenia_HUBTech 2020 prok.xlsx", "DANE_UTP"],
    ["MLM/UTP_TREM_2022.xlsx", "DANE_TREM"],
    ["ZASTAL/Zestawienie zlecen (wszystkie instrumenty).xlsx", "DANE_BROKERSKIE"],
  ])("klasyfikacja GPW pozostaje nietknięta: %s → %s", (plik, oczekiwany) => {
    expect(classifyPath(plik)).toBe(oczekiwany);
  });
});

describe("raport kompletności", () => {
  const docs = AKTA_MBR.map((p) => ({ rel_path: p, doc_type: classifyPath(p, "ryzyko_bankowe") }));

  it("wypisuje moduły dziedziny bankowej, nie techniki GPW", () => {
    // Lista modułów brana ze stałej WYMOGI powodowała, że raport sprawy bankowej
    // wypisywał wash trades i layering — techniki, których ta dziedzina nie zna.
    const r = buildCompleteness(docs, "ryzyko_bankowe");
    const kody = r.techniki.map((t) => t.kind);
    expect(kody).toContain("adekwatnosc");
    expect(kody).toContain("limity");
    expect(kody).not.toContain("wash");
    expect(kody).not.toContain("layering");
  });

  it("brak sprawozdań blokuje współczynniki kapitałowe", () => {
    const bez = docs.filter((d) => d.doc_type !== "SPRAWOZDANIE_BANK");
    const r = buildCompleteness(bez, "ryzyko_bankowe");
    const adekw = r.techniki.find((t) => t.kind === "adekwatnosc");
    expect(adekw?.dostepna).toBe(false);
    expect(r.braki_krytyczne.join(" ")).toContain("Sprawozdania");
  });

  it("postanowienie SĄDU też powołuje biegłego — sprawa bankowa bywa cywilna", () => {
    // Wymóg pytał wyłącznie o kod prokuratorski POSTANOWIENIE. W sprawie SK Banku
    // (II C 595/23) dowód z opinii dopuścił sąd, więc postanowienie leżało w aktach
    // jako POSTANOWIENIE_SAD — a raport wykazywał brak KRYTYCZNY dokumentu, który jest.
    const akta = [{ rel_path: "SKM_C451i26080212340.ocr.pdf", doc_type: "POSTANOWIENIE_SAD" }];
    const r = buildCompleteness(akta, "ryzyko_bankowe");
    expect(r.wymogi.find((x) => x.wymog.id === "postanowienie")!.spelniony).toBe(true);
    expect(r.braki_krytyczne.join(" ")).not.toContain("Postanowienie");
  });

  it("moduł chronologii nadzoru jest w ogóle wymieniany", () => {
    // Moduł dołączył do pakietu przy sprawie SK Banku i nie był odblokowywany przez
    // żaden wymóg — nie pojawiał się ani wśród dostępnych, ani wśród zablokowanych.
    // Jedyny moduł odpowiadający na pytanie „od kiedy dało się rozpoznać" był niewidoczny.
    const r = buildCompleteness(docs, "ryzyko_bankowe");
    expect(r.techniki.map((t) => t.kind)).toContain("chronologia_nadzoru");
    const chrono = r.techniki.find((t) => t.kind === "chronologia_nadzoru")!;
    expect(chrono.label).not.toBe("chronologia_nadzoru");   // ma etykietę, nie surowy kod
  });

  it("materiały nadzoru odblokowują chronologię", () => {
    const akta = [{ rel_path: "harmonogram dzialan UKNF.pdf", doc_type: "NADZOR_KNF" }];
    const r = buildCompleteness(akta, "ryzyko_bankowe");
    expect(r.techniki.find((t) => t.kind === "chronologia_nadzoru")!.dostepna).toBe(true);
  });

  it("skan bez warstwy tekstowej NIE spełnia wymogu", () => {
    // Najgroźniejszy błąd, jaki ta aplikacja może popełnić: w sprawie MBR raport
    // pokazał 10/10, a dziewięć kluczowych dokumentów miało zero znaków na 125
    // stronach. Obecność pliku w aktach to nie to samo co dostęp do jego treści.
    const skan = [{ rel_path: "postanowienie o powołaniu biegłego.pdf", doc_type: "POSTANOWIENIE", warstwa_tekstu: "brak" }];
    const r = buildCompleteness(skan, "ryzyko_bankowe");
    const w = r.wymogi.find((x) => x.wymog.id === "postanowienie")!;
    expect(w.spelniony).toBe(false);
    expect(w.bezOcr).toContain("postanowienie o powołaniu biegłego.pdf");
  });

  it("ten sam skan po OCR spełnia wymóg", () => {
    const poOcr = [{ rel_path: "postanowienie o powołaniu biegłego.pdf", doc_type: "POSTANOWIENIE", warstwa_tekstu: "ocr" }];
    const w = buildCompleteness(poOcr, "ryzyko_bankowe").wymogi.find((x) => x.wymog.id === "postanowienie")!;
    expect(w.spelniony).toBe(true);
    expect(w.bezOcr).toEqual([]);
  });

  it("dokumenty sprzed migracji 0011 (bez informacji) liczą się jak dotąd", () => {
    const stare = [{ rel_path: "postanowienie.pdf", doc_type: "POSTANOWIENIE" }];
    expect(buildCompleteness(stare, "ryzyko_bankowe").wymogi.find((x) => x.wymog.id === "postanowienie")!.spelniony).toBe(true);
  });

  it("sprawa bez typu zachowuje raport GPW", () => {
    const r = buildCompleteness([{ rel_path: "x.xlsx", doc_type: "DANE_UTP" }]);
    expect(r.techniki.map((t) => t.kind)).toContain("wash");
  });
});

describe("katalog prawny datowany", () => {
  it("dla decyzji z 11.09.2008 daje stan prawny z tamtej daty", () => {
    const refy = przepisyNaDzien("2008-09-11").map((p) => p.ref);
    // To przepis, na którym biegły faktycznie oparł wnioski w sprawie MBR.
    expect(refy).toContain("Uchwała nr 5/2007 KNB, § 5");
    expect(refy.some((r) => r.includes("CRR"))).toBe(false);
  });

  it("oznacza CRR jako anachronizm wobec zdarzenia z 2008", () => {
    // Powołanie CRR do oceny decyzji sprzed 2014 to błąd, który obrona wytknie.
    const anach = przepisyAnachroniczne("2008-09-11").map((p) => p.ref);
    expect(anach).toContain("art. 92 CRR");
  });

  it("dla zdarzenia z 2020 daje CRR zamiast uchwał KNB", () => {
    const refy = przepisyNaDzien("2020-06-01", "adekwatnosc").map((p) => p.ref);
    expect(refy).toContain("art. 92 CRR");
    expect(refy.some((r) => r.includes("KNB"))).toBe(false);
  });
});

describe("rejestr pakietów dziedzinowych", () => {
  it("sprawa bez typu spada na dziedzinę GPW", () => {
    // Trzy sprawy założone przed migracją 0010 nie mają typu i muszą działać.
    expect(packDla(null).id).toBe("manipulacja_gpw");
    expect(packDla("nieznany").id).toBe("manipulacja_gpw");
  });

  it("obie dziedziny mają 6–8 rozdziałów głównych", () => {
    // Szkielet jest stały w obrębie dziedziny; zmienna jest liczba podrozdziałów.
    for (const p of WSZYSTKIE_PAKIETY) {
      expect(p.szkielet.length).toBeGreaterThanOrEqual(6);
      expect(p.szkielet.length).toBeLessThanOrEqual(8);
    }
  });

  it("rola rozdziału jest wspólna dla dziedzin — stąd współdzielony korpus stylu", () => {
    const role = (id: string) =>
      WSZYSTKIE_PAKIETY.find((p) => p.id === id)!.szkielet.map((r) => r.rola);
    for (const rola of ["proza_i", "wnioski", "analiza"]) {
      expect(role("manipulacja_gpw")).toContain(rola);
      expect(role("ryzyko_bankowe")).toContain(rola);
    }
  });

  it("kroki są ROZDZIELNE między dziedzinami", () => {
    // Wymóg twardy: zmiana w jednej dziedzinie nie ma prawa dotknąć drugiej.
    const gpw = packDla("manipulacja_gpw").kroki;
    const bank = packDla("ryzyko_bankowe").kroki;
    // GPW (2026-08): Wskaźniki → Analiza IV.1–7 → Historia akcjonariatu → Warsztat.
    // BANK (wzorzec MBR): Baza wiedzy → Otoczenie prawne → Otoczenie makro →
    // Lista wskaźników → Analiza EF (podzakładki) → Opinia; dawny krok „warsztat"
    // żyje tam jako podzakładka analizy, NIE w stepperze.
    expect(gpw.map((k) => k.klucz)).toEqual([
      "overview", "files", "analysis", "ekonomia", "akcjonariat", "warsztat", "opinion",
    ]);
    expect(bank.map((k) => k.klucz)).toEqual([
      "overview", "files", "wiedza", "prawo", "makro", "wskazniki", "analysis", "opinion",
    ]);
    // Kroki jednej dziedziny nie mają prawa pojawić się w drugiej — w OBIE strony.
    expect(bank.some((k) => k.klucz === "ekonomia")).toBe(false);
    expect(bank.some((k) => k.klucz === "warsztat")).toBe(false);
    // Historia akcjonariatu jest krokiem WYŁĄCZNIE manipulacyjnym: w sprawie bankowej
    // nie ma emitenta giełdowego, którego stan posiadania dałoby się śledzić.
    expect(bank.some((k) => k.klucz === "akcjonariat")).toBe(false);
    for (const klucz of ["wiedza", "prawo", "makro", "wskazniki"]) {
      expect(gpw.some((k) => k.klucz === klucz)).toBe(false);
    }
    expect(gpw.findIndex((k) => k.klucz === "akcjonariat")).toBeLessThan(gpw.findIndex((k) => k.klucz === "warsztat"));
    // Etykiety kroku „analysis" są PRZYPIĘTE i różne: „Wskaźniki" w manipulacjach
    // (nazwa od biegłego, 7.08.2026 — wcześniej „Analiza liczbowa"), w dziedzinie
    // bankowej „Analiza ekonomiczno-finansowa". Plik jest wspólny dla obu pakietów,
    // więc najłatwiej tu przenieść zmianę na cudzą dziedzinę.
    const gpwAnaliza = gpw.find((k) => k.klucz === "analysis")!;
    const bankAnaliza = bank.find((k) => k.klucz === "analysis")!;
    expect(gpwAnaliza.label).toBe("Wskaźniki");
    expect(bankAnaliza.label).not.toBe(gpwAnaliza.label);
    const stan = {
      dokumentow: 5, metryk: 0, zatwierdzone: 0, checklistOk: true,
      subanalizy: ["techniki", "powiazania_dane"],
    };
    // subanalizy GPW kończą warsztat w manipulacjach — a w banku nie kończą niczego
    const gpwWarsztat = gpw.find((k) => k.klucz === "warsztat")!;
    expect(gpwWarsztat.gotowy(stan)).toBe(true);
    expect(bank.find((k) => k.klucz === "analysis")!.gotowy(stan)).toBe(false);
    // krok 4 GPW kończy dopiero subanaliza ekofin_dane
    const krok4 = gpw.find((k) => k.klucz === "ekonomia")!;
    expect(krok4.gotowy(stan)).toBe(false);
    expect(krok4.gotowy({ ...stan, subanalizy: ["ekofin_dane"] })).toBe(true);
  });

  it("warunki ukończenia nowych kroków bankowych odpowiadają ich treści", () => {
    const bank = packDla("ryzyko_bankowe").kroki;
    const krok = (klucz: string) => bank.find((k) => k.klucz === klucz)!;
    const stan = { dokumentow: 5, metryk: 0, zatwierdzone: 0, checklistOk: true, subanalizy: [] as string[] };
    // Baza wiedzy: kończy ją obecność źródeł dziedziny w repozytorium, nie subanaliza.
    expect(krok("wiedza").gotowy(stan)).toBe(false);
    expect(krok("wiedza").gotowy({ ...stan, wiedza: 10 })).toBe(true);
    // Otoczenie prawne: kończy zapisany moduł otoczenie_prawne.
    expect(krok("prawo").gotowy(stan)).toBe(false);
    expect(krok("prawo").gotowy({ ...stan, subanalizy: ["otoczenie_prawne"] })).toBe(true);
    // Otoczenie makro: kończą go szeregi tła (moduł makro). Sygnały rynkowe
    // (CDS/ratingi, wzorzec V.G–H) należą do ANALIZY, nie do tła — same nie
    // kończą kroku makro.
    expect(krok("makro").gotowy(stan)).toBe(false);
    expect(krok("makro").gotowy({ ...stan, subanalizy: ["makro"] })).toBe(true);
    expect(krok("makro").gotowy({ ...stan, subanalizy: ["sygnaly_rynkowe"] })).toBe(false);
    // Lista wskaźników: katalog referencyjny — zawsze dostępny, niczego nie liczy.
    expect(krok("wskazniki").gotowy(stan)).toBe(true);
    // Analiza EF: jak dotąd — metryki silnika albo subanaliza wskazniki_bank.
    expect(krok("analysis").gotowy({ ...stan, subanalizy: ["wskazniki_bank"] })).toBe(true);
    // Warsztat (procedury+limity) NIE kończy już kroków merytorycznych steppera —
    // jest podzakładką analizy; jego stan widać w panelu, nie w stepperze.
    const stanWarsztatu = { ...stan, subanalizy: ["procedury", "limity"] };
    for (const klucz of ["wiedza", "prawo", "makro", "analysis", "opinion"] as const) {
      expect(krok(klucz).gotowy(stanWarsztatu), klucz).toBe(false);
    }
  });

  it("wymagane typy dziedziny bankowej wywodzą się z wymogów krytycznych", () => {
    // Od czasu, gdy typy jednego wymogu są ALTERNATYWĄ, funkcja zwraca grupy,
    // a nie płaską listę kodów — patrz „lista kontrolna dokumentów wymaganych".
    const kody = wymaganeTypy("ryzyko_bankowe").required.flatMap((g) => g.kody);
    expect(kody).toContain("SPRAWOZDANIE_BANK");
    expect(kody).toContain("METODYKA_LIMITOW");
    expect(kody).not.toContain("DANE_UTP");
  });
});

describe("builder opinii bankowej", () => {
  const doc = { rel_path: "akta/postanowienie.pdf", provenance: "wejście" as const, doc_type: "POSTANOWIENIE" };
  const sub = (kind: string, title: string) => ({
    kind, title, chapter_no: "V", status: "szkic" as const, body_md: "treść rozdziału",
    data: { table: { caption: `Tabela ${kind}`, head: ["a"], rows: [["1"]] } },
  });

  it("składa szkielet I–VIII, nie I–VI", () => {
    const op = buildOpinionBank({ name: "MBR", signature: "PO III Ds 84.2020" }, [], [doc], []);
    expect(op.chapters.filter((c) => !c.no.includes(".") && c.no !== "—").map((c) => c.no))
      .toEqual(["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]);
    // Rozdział „Uwaga techniczna" pojawia się TYLKO przy rozjeździe ze szkieletem pakietu.
    expect(op.chapters.some((c) => c.no === "—")).toBe(false);
  });

  it("podstawa prawna wynika z DATY ZDARZENIA, nie z dnia pisania opinii", () => {
    const z2008 = buildOpinionBank({ name: "MBR", signature: null }, [], [doc], [], "2008-09-11");
    expect(z2008.legalBasis.join(" ")).toContain("Uchwała nr 5/2007 KNB");
    expect(z2008.legalBasis.join(" ")).not.toContain("CRR");

    const z2020 = buildOpinionBank({ name: "X", signature: null }, [], [doc], [], "2020-06-01");
    expect(z2020.legalBasis.join(" ")).toContain("CRR");
  });

  it("bez daty zdarzenia NIE zgaduje stanu prawnego", () => {
    const op = buildOpinionBank({ name: "MBR", signature: null }, [], [doc], []);
    const ii = op.chapters.find((c) => c.no === "II")!;
    expect(ii.status).toBe("todo");
    expect(ii.paras[0].text).toContain("datę ocenianego zdarzenia");
  });

  it("moduły rozdziału V numeruje literami bez luk", () => {
    // W aktach są tylko trzy z dziewięciu modułów — numeracja ma być A, B, C.
    const op = buildOpinionBank({ name: "MBR", signature: null }, [], [doc], [
      sub("wskazniki_bank", "Wskaźniki"), sub("limity", "Limity"), sub("procedury", "Procedury"),
    ]);
    expect(op.chapters.filter((c) => c.no.startsWith("V.")).map((c) => c.no)).toEqual(["V.A", "V.B", "V.C"]);
  });
});

describe("lista kontrolna dokumentów wymaganych", () => {
  it("typy jednego wymogu są ALTERNATYWĄ, nie koniunkcją", () => {
    // Wymóg „postanowienie o powołaniu biegłego" spełnia POSTANOWIENIE
    // (prokuratorskie), POSTANOWIENIE_SAD (sądowe) albo PYTANIA_BIEGLY. Płaska lista
    // kodów kazała listy kontrolnej żądać wszystkich trzech naraz — żądanie
    // niespełnialne z definicji, bo prokurator i sąd nie wydają tego samego
    // orzeczenia. W sprawie SK Banku dawało to zgłoszenie braku dokumentu,
    // który leży w aktach.
    const { required } = wymaganeTypy("ryzyko_bankowe", "nadzor_nad_bankiem");
    const g = required.find((x) => x.label.includes("Postanowienie"))!;
    expect(g.kody).toEqual(["POSTANOWIENIE", "POSTANOWIENIE_SAD", "PYTANIA_BIEGLY"]);
    // Sprawa cywilna ma wyłącznie postanowienie sądu — i to wystarcza.
    expect(g.kody.some((k) => ["POSTANOWIENIE_SAD"].includes(k))).toBe(true);
  });

  it("krytyczność grup zależy od roli procesowej", () => {
    const nadzor = wymaganeTypy("ryzyko_bankowe", "nadzor_nad_bankiem").required.map((g) => g.label);
    const kontrahent = wymaganeTypy("ryzyko_bankowe", "ocena_kontrahenta").required.map((g) => g.label);
    expect(nadzor.join(" ")).toContain("organu nadzoru");
    expect(kontrahent.join(" ")).toContain("Metodyka");
    expect(kontrahent.join(" ")).not.toContain("organu nadzoru");
  });

  it("dziedzina GPW zostaje przy jednym kodzie na wymóg", () => {
    // Arkusz zleceń i odpisy KRS to różne dokumenty, nie warianty tego samego.
    const { required } = wymaganeTypy(null);
    expect(required.every((g) => g.kody.length === 1)).toBe(true);
    expect(required.map((g) => g.kody[0])).toContain("DANE_UTP");
  });
});

describe("czytelność dokumentu, nie pliku", () => {
  it("wariant po OCR podzielony na CZĘŚCI też czyni dokument czytelnym", () => {
    // ⚠️ Skan większy niż limit magazynu zapisuje się jako `X.ocr.cz1.pdf`
    // i `X.ocr.cz2.pdf`. Rozpoznanie szukające wyłącznie `X.ocr.pdf` tych części
    // nie widziało i aplikacja wzywała biegłego do zrobienia OCR-u, który był
    // już zrobiony — na dwóch największych dokumentach sprawy SK Banku
    // (akty oskarżenia, 342 strony każdy).
    const akta = [
      { rel_path: "SKOK/akt.pdf", doc_type: "AKT_OSKARZENIA", warstwa_tekstu: "brak" },
      { rel_path: "SKOK/akt.ocr.cz1.pdf", doc_type: "AKT_OSKARZENIA", warstwa_tekstu: "ocr" },
      { rel_path: "SKOK/akt.ocr.cz2.pdf", doc_type: "AKT_OSKARZENIA", warstwa_tekstu: "ocr" },
    ];
    expect(doOcr(akta)).toEqual([]);
  });

  it("skan BEZ żadnego czytelnego wariantu zostaje luką", () => {
    const akta = [{ rel_path: "SKOK/sam.pdf", doc_type: "PROTOKOL", warstwa_tekstu: "brak" }];
    expect(doOcr(akta).map((d) => d.rel_path)).toEqual(["SKOK/sam.pdf"]);
  });

  it("rdzeń dokumentu skleja wszystkie warianty w jedną pozycję", () => {
    const warianty = ["a/x.pdf", "a/x.ocr.pdf", "a/x.ocr.cz1.pdf", "a/x.ocr.cz2.pdf"];
    expect(new Set(warianty.map(rdzenDokumentu)).size).toBe(1);
    expect(rdzenDokumentu("a/x.ocr.cz2.pdf")).toBe("x.pdf");
  });

  it("wymóg nie wypisuje do OCR pliku, którego dokument jest odczytany", () => {
    const akta = [
      { rel_path: "SKOK/spr.pdf", doc_type: "SPRAWOZDANIE_BANK", warstwa_tekstu: "brak" },
      { rel_path: "SKOK/spr.ocr.cz1.pdf", doc_type: "SPRAWOZDANIE_BANK", warstwa_tekstu: "ocr" },
    ];
    const w = buildCompleteness(akta, "ryzyko_bankowe").wymogi.find((x) => x.wymog.id === "sprawozdania_kontrahenta")!;
    expect(w.spelniony).toBe(true);
    expect(w.bezOcr).toEqual([]);
  });
});
