/**
 * Függőségmentes i18n — a projekt minimál-függőség filozófiájához illően nincs
 * külső könyvtár (react-i18next stb.). Egy Context adja a `t(key, vars)` fordító
 * függvényt, a nyelvet localStorage-ban tartjuk, és a hiányzó kulcs a magyar
 * (alap) szövegre, végső soron magára a kulcsra esik vissza.
 *
 * Új szöveg felvétele: adj kulcsot MINDKÉT szótárhoz (hu + en), majd a
 * komponensben `const t = useT();` és `t("kulcs")`. Változók: `t("x", { n: 3 })`
 * a szövegben `{n}` helyőrzővel.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "hu" | "en";

const LANG_KEY = "mediachat-lang";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "hu", label: "Magyar" },
  { code: "en", label: "English" },
];

type Dict = Record<string, string>;

const hu: Dict = {
  // Nyelv
  "lang.label": "Nyelv",
  // Szerepkör
  "role.admin": "Admin",
  "role.user": "Felhasználó",
  // Sidebar navigáció
  "nav.chat": "Chat",
  "nav.recommendations": "Ajánlások",
  "nav.calendar": "Naptár",
  "nav.dashboard": "Dashboard",
  "nav.storage": "Tárhely",
  "nav.jobs": "Feladatok",
  "nav.logs": "Naplók",
  "nav.audit": "Audit napló",
  "nav.settings": "Beállítások",
  // Sidebar akciók / tooltipek
  "sidebar.expand": "Menü kinyitása",
  "sidebar.collapse": "Menü összecsukása",
  "sidebar.close": "Menü bezárása",
  "sidebar.account": "Fiókom",
  "sidebar.theme": "Téma választása",
  "sidebar.language": "Nyelv választása",
  "sidebar.logout": "Kilépés",
  // Relatív idő
  "rel.never": "soha",
  "rel.today": "ma",
  "rel.yesterday": "tegnap",
  "rel.daysAgo": "{n} napja",
  // Idő-egységek
  "time.hourShort": "ó",
  "time.minShort": "p",
  // Jellyfin analitika
  "analytics.title": "Jellyfin nézők",
  "analytics.summary": "{users} felhasználó · összesen {time} lejátszás",
  "analytics.notConfigured": "Jellyfin nézők — nincs Jellyfin konfigurálva",
  "analytics.noData": "Jellyfin nézők — még nincs nézési adat",
  "analytics.lastActivity": "Utolsó aktivitás: {when}",
  "analytics.watched": "nézett",
  "analytics.total": "összesen",
  "analytics.avg": "átlag",
  "analytics.inProgress": "Folyamatban",
  "analytics.recent": "Legutóbb nézett",
  "analytics.countsShort": "{movies}f/{episodes}e",
};

const en: Dict = {
  "lang.label": "Language",
  "role.admin": "Admin",
  "role.user": "User",
  "nav.chat": "Chat",
  "nav.recommendations": "Recommendations",
  "nav.calendar": "Calendar",
  "nav.dashboard": "Dashboard",
  "nav.storage": "Storage",
  "nav.jobs": "Jobs",
  "nav.logs": "Logs",
  "nav.audit": "Audit log",
  "nav.settings": "Settings",
  "sidebar.expand": "Expand menu",
  "sidebar.collapse": "Collapse menu",
  "sidebar.close": "Close menu",
  "sidebar.account": "My account",
  "sidebar.theme": "Choose theme",
  "sidebar.language": "Choose language",
  "sidebar.logout": "Log out",
  "rel.never": "never",
  "rel.today": "today",
  "rel.yesterday": "yesterday",
  "rel.daysAgo": "{n} days ago",
  "time.hourShort": "h",
  "time.minShort": "min",
  "analytics.title": "Jellyfin viewers",
  "analytics.summary": "{users} users · {time} watched total",
  "analytics.notConfigured": "Jellyfin viewers — Jellyfin is not configured",
  "analytics.noData": "Jellyfin viewers — no watch data yet",
  "analytics.lastActivity": "Last activity: {when}",
  "analytics.watched": "watched",
  "analytics.total": "total",
  "analytics.avg": "average",
  "analytics.inProgress": "In progress",
  "analytics.recent": "Recently watched",
  "analytics.countsShort": "{movies}m/{episodes}e",
};

const DICTS: Record<Lang, Dict> = { hu, en };

function detect(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "hu" || stored === "en") return stored;
  } catch {
    /* SSR / privát mód */
  }
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) return "en";
  return "hu";
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({ lang: "hu", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* privát mód */
    }
    setLangState(next);
  }, []);

  const t = useCallback<TFunc>(
    (key, vars) => {
      let s = DICTS[lang][key] ?? DICTS.hu[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split(`{${k}}`).join(String(v));
        }
      }
      return s;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function useT(): TFunc {
  return useContext(I18nContext).t;
}
