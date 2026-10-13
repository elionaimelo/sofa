const en = {
  allGames: "All games",
  sources: "Sources",
  search: "Search",
  searchGames: "Search games",
  scanning: "Scanning libraries…",
  noMatches: "No matches.",
  noGames: "No installed games found in Steam, Epic or GOG.",
  launching: "Launching {title}…",
  launchFailed: "Couldn't launch {title}: {error}",
  play: "Play",
  source: "Source",
  language: "Language",
  updateAvailable: "Update {version} available",
  updating: "Installing update {version}…",
  updateFailed: "Update failed: {error}",
};
type Dict = Record<keyof typeof en, string>;

// Adding a language = one entry here; the Dict type flags any missing key at compile time.
const dicts = {
  en,
  "pt-BR": {
    allGames: "Todos os jogos",
    sources: "Origens",
    search: "Buscar",
    searchGames: "Buscar jogos",
    scanning: "Procurando bibliotecas…",
    noMatches: "Nada encontrado.",
    noGames: "Nenhum jogo instalado encontrado na Steam, Epic ou GOG.",
    launching: "Abrindo {title}…",
    launchFailed: "Não foi possível abrir {title}: {error}",
    play: "Jogar",
    source: "Origem",
    language: "Idioma",
    updateAvailable: "Atualização {version} disponível",
    updating: "Instalando atualização {version}…",
    updateFailed: "Falha na atualização: {error}",
  },
  es: {
    allGames: "Todos los juegos",
    sources: "Orígenes",
    search: "Buscar",
    searchGames: "Buscar juegos",
    scanning: "Buscando bibliotecas…",
    noMatches: "Sin resultados.",
    noGames: "No se encontraron juegos instalados en Steam, Epic o GOG.",
    launching: "Iniciando {title}…",
    launchFailed: "No se pudo iniciar {title}: {error}",
    play: "Jugar",
    source: "Origen",
    language: "Idioma",
    updateAvailable: "Actualización {version} disponible",
    updating: "Instalando actualización {version}…",
    updateFailed: "Error al actualizar: {error}",
  },
} satisfies Record<string, Dict>;

export type Lang = keyof typeof dicts;
export const LANGS: Record<Lang, string> = { en: "English", "pt-BR": "Português (Brasil)", es: "Español" };

const LANG_KEY = "lang";
const langs = Object.keys(dicts) as Lang[];

/** Saved choice, else the first OS language that matches exactly or by base ("pt-PT" → "pt-BR"). */
export function initialLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  if (langs.includes(saved as Lang)) return saved as Lang;
  for (const l of navigator.languages) {
    const hit = langs.find((x) => x === l) ?? langs.find((x) => x.split("-")[0] === l.split("-")[0]);
    if (hit) return hit;
  }
  return "en";
}

export function saveLang(l: Lang) {
  localStorage.setItem(LANG_KEY, l);
  document.documentElement.lang = l;
}

export const translator = (l: Lang) => (key: keyof Dict, vars: Record<string, string> = {}) =>
  dicts[l][key].replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
