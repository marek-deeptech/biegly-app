/**
 * Wstęp rozdziału IV (subanaliza `proza_iv`) — kontener „IV. Analiza” przed IV.1.
 *
 * Wzorzec: finał HubTech ma między nagłówkiem „IV. ANALIZA” a podrozdziałem IV.1
 * pięć bloków wprowadzenia (przedmiot i dni sesyjne, profil emitenta, wprowadzenie
 * do obrotu i debiut, system notowań, kontekst informacyjny). Bez tego kontenera
 * opinia zaczynała rozdział IV od razu tabelami IV.1 — czytelnik nie wiedział,
 * czego dotyczy analiza ani ilu sesji.
 *
 * ⚠️ ROZDZIAŁ POWSTAJE TYLKO Z TREŚCIĄ. Pusty kontener „IV. Analiza” w każdej
 * sprawie byłby wydmuszką w spisie treści i w eksporcie.
 */
import { describe, expect, it } from "vitest";
import { buildOpinionDla } from "@/lib/opinion/build-router";

const PUSTE = {
  name: "ZASTAL", signature: "III K 193/23/1", group_roster: null,
  typ: "manipulacja_gpw", tryb: null, rola: null, organ: null, data_powolania: null,
};
const sub = (kind: string, chapter_no: string, body_md = "", data: Record<string, unknown> = {}) =>
  ({ kind, chapter_no, title: kind, status: "szkic", body_md, data }) as never;

describe("wstęp rozdziału IV", () => {
  it("bez subanalizy proza_iv nie ma kontenera „IV” — brak pustej wydmuszki", () => {
    const o = buildOpinionDla(PUSTE, [], [], []);
    const iv = o.chapters.find((c) => c.no === "IV");
    expect(iv).toBeUndefined();
  });

  it("z proza_iv rozdział IV pojawia się PRZED podrozdziałami IV.x", () => {
    const o = buildOpinionDla(
      PUSTE, [], [],
      [
        sub("ekofin", "IV.1", "treść ekofin"),
        sub("proza_iv", "IV", "Opinia dotyczy obrotu akcjami CSY S.A. i RSY S.A. w ASO NewConnect."),
      ],
    );
    const numery = o.chapters.map((c) => c.no);
    const iIV = numery.indexOf("IV");
    const iIV1 = numery.findIndex((n) => n.startsWith("IV."));
    expect(iIV).toBeGreaterThanOrEqual(0);
    expect(iIV1).toBeGreaterThan(iIV);
    const iv = o.chapters[iIV];
    expect(iv.title).toBe("Analiza");
    expect(iv.paras.some((p) => p.text.includes("CSY S.A."))).toBe(true);
  });

  it("nie wypiera rozdziałów stałych ani nie dubluje numeru IV", () => {
    const o = buildOpinionDla(PUSTE, [], [], [sub("proza_iv", "IV", "wstęp")]);
    const glowne = o.chapters.filter((c) => !c.no.includes(".")).map((c) => c.no);
    expect(glowne).toEqual(["I", "II", "III", "IV", "V", "VI"]);
    expect(glowne.filter((n) => n === "IV")).toHaveLength(1);
  });
});
