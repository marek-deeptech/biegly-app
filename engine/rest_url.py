"""Budowanie adresów PostgREST z wartości, których nie kontrolujemy.

⚠️ POWÓD. Usługi składały adres doklejaniem wartości do f-stringa. Działało, dopóki
w filtrze stały same UUID-y i slugi. Kiedy zakresowe kasowanie metryk zaczęło
wymieniać KLUCZE, w filtrze pojawiło się `ede_bval::profit estate` — nazwa podmiotu
ze spacją. `urllib` odmawia wtedy wysłania żądania („URL can't contain control
characters"), więc cały bieg TREM kończył się błędem, a użytkownik widział wewnętrzny
komunikat biblioteki zamiast informacji, co poszło nie tak.

Spacja to najłagodniejszy przypadek: `&`, `#` i `,` w wartości filtru zmieniałyby jego
znaczenie po cichu, bez żadnego wyjątku.
"""
import urllib.parse

__all__ = ["filtr_in", "url_rest"]


def filtr_in(wartosci) -> str:
    """Filtr PostgREST `in.("a","b")` — wartości w cudzysłowach, ze znakami specjalnymi.

    Cudzysłów i odwrotny ukośnik wewnątrz wartości poprzedzamy ukośnikiem, bo w składni
    PostgREST cudzysłów kończyłby wartość.
    """
    części = []
    for w in wartosci:
        s = str(w).replace("\\", "\\\\").replace('"', '\\"')
        części.append(f'"{s}"')
    return f"in.({','.join(części)})"


def url_rest(base: str, sciezka: str, **filtry: str) -> str:
    """Adres zasobu PostgREST z ZAKODOWANYMI wartościami filtrów.

        url_rest(BASE, "metrics", case_id=f"eq.{cid}", key=filtr_in(klucze))

    Nazwy filtrów są nasze (kolumny), więc idą bez zmian; kodujemy wartości —
    `quote` zamiast domyślnego `quote_plus`, żeby spacja stała się „%20", a nie „+"
    (w ścieżce „+" nie znaczy spacji i różnica potrafi zaskoczyć przy debugowaniu).
    """
    zapytanie = urllib.parse.urlencode(filtry, quote_via=urllib.parse.quote, safe="")
    return f"{base.rstrip('/')}/rest/v1/{sciezka.lstrip('/')}?{zapytanie}"
