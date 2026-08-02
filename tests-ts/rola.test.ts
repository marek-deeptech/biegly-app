import { describe, expect, it } from "vitest";

import { blokRoli, kodRoli, ROLE, rolaDla } from "@/lib/domain/rola";
import { blokTrybu } from "@/lib/domain/tryb";
import { buildCompleteness, czyKrytyczny } from "@/lib/intake/completeness";
import { WYMOGI_BANK } from "@/lib/domain/taxonomy-bank";

describe("rola procesowa", () => {
  it("domyślnie ocena kontrahenta — sprawy sprzed migracji 0015 działają bez zmian", () => {
    expect(rolaDla(null)).toBe(ROLE.ocena_kontrahenta);
    expect(rolaDla("wymyślona")).toBe(ROLE.ocena_kontrahenta);
    expect(kodRoli(undefined)).toBe("ocena_kontrahenta");
  });

  it("w sprawie o nadzór zakazuje nazywania podmiotu kontrahentem", () => {
    // Model przenosił ramę pierwszej sprawy bankowej i pisał o „kontrahencie" tam,
    // gdzie badany jest bank pod nadzorem, a kontrahenta w sprawie w ogóle nie ma.
    const b = blokRoli("nadzor_nad_bankiem");
    expect(b).toContain("ORGANU NADZORU");
    expect(b).toContain("bank objęty nadzorem");
    expect(b).toContain("nie używaj określenia");
  });

  it("każda rola mówi, czego biegły w niej NIE ustala", () => {
    for (const kod of Object.keys(ROLE) as (keyof typeof ROLE)[]) {
      expect(blokRoli(kod)).toContain("POZA ZAKRESEM TEJ OPINII");
    }
  });

  it("rola i tryb to osobne osie — odpowiadają na różne pytania", () => {
    // Tryb: KOMU biegły odpowiada. Rola: CZYJE zachowanie ocenia. Sprawa bankowa
    // bywa cywilna i dotyczyć nadzoru (SK Bank) albo karna i dotyczyć decyzji
    // banku (MBR) — ale każda kombinacja jest możliwa.
    const tryb = blokTrybu("cywilne");
    const rola = blokRoli("nadzor_nad_bankiem");
    expect(tryb).toContain("sądu cywilnego");
    expect(tryb).not.toContain("ORGANU NADZORU");
    expect(rola).not.toContain("sądu cywilnego");
  });
});

describe("krytyczność wymogów zależy od roli", () => {
  const bez = (id: string) =>
    buildCompleteness(
      // akta zawierające WSZYSTKO poza jednym wymogiem
      WYMOGI_BANK.filter((w) => w.id !== id).flatMap((w) =>
        w.docTypes.map((t) => ({ rel_path: `${w.id}.pdf`, doc_type: t })),
      ),
      "ryzyko_bankowe",
      "karne",
    );

  it("metodyka limitów: rdzeń przy ocenie decyzji banku", () => {
    const w = WYMOGI_BANK.find((x) => x.id === "metodyka_limitow")!;
    expect(czyKrytyczny(w, "ocena_kontrahenta")).toBe(true);
    expect(czyKrytyczny(w, "organy_banku")).toBe(true);
  });

  it("metodyka limitów: NIE rdzeń w sprawie przeciwko nadzorcy", () => {
    // Dokument leży u syndyka upadłego banku i nikt o niego nie pyta. Oznaczony
    // krytycznym, kazał raportowi twierdzić, że opinii nie da się wydać.
    const w = WYMOGI_BANK.find((x) => x.id === "metodyka_limitow")!;
    expect(czyKrytyczny(w, "nadzor_nad_bankiem")).toBe(false);
  });

  it("materiały nadzoru: odwrotnie — rdzeń dopiero w sprawie o nadzór", () => {
    const w = WYMOGI_BANK.find((x) => x.id === "nadzor")!;
    expect(czyKrytyczny(w, "nadzor_nad_bankiem")).toBe(true);
    expect(czyKrytyczny(w, "ocena_kontrahenta")).toBe(false);
  });

  it("postanowienie o powołaniu biegłego jest krytyczne w KAŻDEJ roli", () => {
    const w = WYMOGI_BANK.find((x) => x.id === "postanowienie")!;
    for (const kod of Object.keys(ROLE)) expect(czyKrytyczny(w, kod)).toBe(true);
  });

  it("ten sam brak jest krytyczny w jednej roli, a zwykły w drugiej", () => {
    const akta = bez("metodyka_limitow");
    const braki = (rola: string) =>
      buildCompleteness(
        WYMOGI_BANK.filter((w) => w.id !== "metodyka_limitow").flatMap((w) =>
          w.docTypes.map((t) => ({ rel_path: `${w.id}.pdf`, doc_type: t })),
        ),
        "ryzyko_bankowe",
        "karne",
        rola,
      ).braki_krytyczne;
    expect(akta.wymogi.find((x) => x.wymog.id === "metodyka_limitow")!.spelniony).toBe(false);
    expect(braki("ocena_kontrahenta").join(" ")).toContain("Metodyka");
    expect(braki("nadzor_nad_bankiem")).toEqual([]);
  });
});
