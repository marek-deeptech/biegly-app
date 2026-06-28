# Biegły GPW — silnik faktów (MVP)

Narzędzie wspierające biegłego sądowego (Krzysztof Michrowski) w analizie manipulacji
instrumentami finansowymi na GPW i przygotowaniu opinii dla prokuratury i sądu.

To repozytorium zawiera **silnik faktów** — pierwszy, deterministyczny rdzeń docelowej
aplikacji. Zasada nadrzędna: **liczy kod, nie model językowy.** LLM będzie jedynie
opisywał i interpretował policzone liczby; nigdy ich nie wyznacza.

## Status — zwalidowany na sprawie HubTech (RP I Ds 4.2019)

Silnik odtwarza opublikowane liczby z opinii **co do sztuki / grosza**:

| Wskaźnik | Silnik | Cel (opinia) |
|---|---|---|
| Transakcje / wartość / wolumen | 41 548 / 228 285 987 zł / 180 273 029 szt | identyczne |
| Wash-trades 13.10.2020 | 38,45% | 38,45% |
| Obrót z udziałem Grupy | 108 114 686 zł = 47,36% | 47,36% |
| Joyfix — sprzedaż | 47 419 738 szt; 28,72% | 47 419 738 szt; 28,72% |
| Anulacje kupna 8.10.2020 (layering) | 88% | 88% |

## Uruchomienie

```bash
pip install -r requirements.txt
python -m engine.report        # raport: wskaźniki vs liczby z opinii
pytest -q                      # testy regresyjne złotych liczb
```

Ścieżkę do pliku danych ustawia `engine/settings.py`. Dane akt sprawy są poufne i
**nie są** częścią repozytorium (patrz `.gitignore`).

## Moduły

- `engine/loader.py` — wczytywanie arkuszy UTP (po nazwach kolumn).
- `engine/identity.py` — mapowanie konto→beneficjent + kanonizacja podmiotów Grupy
  (normalizacja wariantów powierniczych, np. „Pekao | Joyfix" → Joyfix).
- `engine/metrics.py` — wskaźniki: wash-trades, obrót Grupy, sprzedaż podmiotu, anulacje.
- `engine/report.py` — zestawienie wyników z liczbami docelowymi.
- `tests/` — regresja na złotych liczbach HubTech.

## Dalej (poza MVP silnika)

Pełny pipeline aplikacji: wgranie i klasyfikacja plików → checklista braków →
walidacja wejścia (QA #1) → analizy pośrednie → robocza opinia z mapą pewności →
recenzent adwersarialny (QA #2) → zatwierdzenie biegłego.
