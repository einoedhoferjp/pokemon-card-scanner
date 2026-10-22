// Gemeinsame SVG-Quelle fuer die PWA- und iOS-Icons.
//
// Ein Motiv, zwei Ziele: `scripts/generate-icons.mjs` schreibt die PWA-Dateien
// nach public/, `scripts/generate-ios-assets.mjs` die App-Icons und den
// Startbildschirm ins Xcode-Projekt.

/** Hintergrund der App (identisch zu theme_color / bg-gray-950). */
export const SPLASH_BG = "#030712";

/**
 * App-Icon: Karte (63:88) auf dunklem Grund, mit erkanntem Rahmen und
 * Vergrößerungsglas.
 *
 * @param {number} size  Kantenlänge in Pixeln
 * @param {{rounded?: boolean, inset?: number}} [opts]
 *   `rounded` rundet die Ecken (PWA); iOS maskiert selbst und braucht ein
 *   deckendes Quadrat. `inset` schrumpft den Inhalt in die "Safe Zone"
 *   (maskable Icons).
 */
export const iconSvg = (size, { rounded = true, inset = 1 } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="1" stop-color="#030712"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" ${rounded ? 'rx="96"' : ""} fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${inset}) translate(-256 -256)">
    <g transform="translate(256 268) rotate(-8)">
      <rect x="-96" y="-128" width="192" height="256" rx="18" fill="url(#card)"/>
      <rect x="-80" y="-112" width="160" height="224" rx="10" fill="#0b1220"/>
      <rect x="-64" y="-92" width="128" height="76" rx="8" fill="#1e293b"/>
      <circle cx="0" cy="-54" r="22" fill="#38bdf8" opacity="0.65"/>
      <rect x="-64" y="4" width="128" height="10" rx="5" fill="#334155"/>
      <rect x="-64" y="26" width="96" height="10" rx="5" fill="#334155"/>
      <rect x="-64" y="48" width="112" height="10" rx="5" fill="#334155"/>
      <rect x="-64" y="70" width="72" height="10" rx="5" fill="#334155"/>
      <rect x="-64" y="102" width="44" height="20" rx="8" fill="#38bdf8" opacity="0.8"/>
    </g>
    <g transform="translate(348 372)">
      <circle r="60" fill="none" stroke="#f8fafc" stroke-width="22" opacity="0.95"/>
      <line x1="42" y1="42" x2="86" y2="86" stroke="#f8fafc" stroke-width="26" stroke-linecap="round" opacity="0.95"/>
    </g>
  </g>
</svg>`;
