// The nine competitions shown on the site, in display order.
//  espn  -> league slug on ESPN's public standings API (the live data source)
//  logo  -> official competition mark hosted by FootyLogos
//  mark  -> how to render that mark on a dark themed background:
//           'white' = use the dedicated white variant, 'invert' = single-colour SVG we can
//           recolour with CSS, 'chip' = multi-colour mark, sit it on a light chip instead
var FL = 'https://assets.footylogos.com/logos/';

window.COMPETITIONS = [
  { id: 'premier-league',    espn: 'eng.1',            name: 'Premier League',    short: 'PL',   region: 'England', group: 'domestic',
    logo: FL + 'premier-league-england/premier-league-england-logo-footylogos.svg',
    logoDark: FL + 'premier-league-england-white-logo-footylogos.svg', mark: 'white' },
  { id: 'championship',      espn: 'eng.2',            name: 'Championship',      short: 'EFL',  region: 'England', group: 'domestic',
    logo: FL + 'efl-championship-england/efl-championship-england-logo-footylogos.svg', mark: 'chip' },
  { id: 'laliga',            espn: 'esp.1',            name: 'LALIGA',            short: 'LL',   region: 'Spain',   group: 'domestic',
    logo: FL + 'laliga-spain/laliga-spain-logo-footylogos.svg', mark: 'invert' },
  { id: 'ligue-1',           espn: 'fra.1',            name: 'Ligue 1',           short: 'L1',   region: 'France',  group: 'domestic',
    logo: FL + 'ligue-1-france/ligue-1-france-logo-footylogos.svg', mark: 'invert' },
  { id: 'bundesliga',        espn: 'ger.1',            name: 'Bundesliga',        short: 'BL',   region: 'Germany', group: 'domestic',
    logo: FL + 'bundesliga-germany/bundesliga-germany-logo-footylogos.svg', mark: 'chip' },
  { id: 'serie-a',           espn: 'ita.1',            name: 'Serie A',           short: 'SA',   region: 'Italy',   group: 'domestic',
    logo: FL + 'serie-a-italy/serie-a-italy-logo-footylogos.svg', mark: 'chip' },
  { id: 'champions-league',  espn: 'uefa.champions',   name: 'Champions League',  short: 'UCL',  region: 'UEFA',    group: 'europe',
    logo: FL + 'uefa-champions-league/uefa-champions-league-logo-footylogos.svg', mark: 'invert' },
  { id: 'europa-league',     espn: 'uefa.europa',      name: 'Europa League',     short: 'UEL',  region: 'UEFA',    group: 'europe',
    logo: FL + 'europa-league/europa-league-logo-footylogos.svg', mark: 'chip' },
  { id: 'conference-league', espn: 'uefa.europa.conf', name: 'Conference League', short: 'UECL', region: 'UEFA',    group: 'europe',
    logo: FL + 'uefa-conference-league/uefa-conference-league-logo-footylogos.svg', mark: 'chip' }
];

// Qualification / relegation zones. ESPN labels these inconsistently ("Promotion playoffs" vs
// "Promotion Playoffs", "Relegated" vs "Relegation"), so every note is folded into one of these
// keys and the key drives both the row stripe colour and the legend text.
window.ZONES = {
  'ucl':        'Champions League',
  'ucl-q':      'Champions League qualifying',
  'uel':        'Europa League',
  'uel-q':      'Europa League qualifying',
  'uecl':       'Conference League',
  'uecl-q':     'Conference League qualifying',
  'promotion':  'Promotion',
  'promo-po':   'Promotion play-offs',
  'r16':        'Round of 16',
  'ko-seeded':  'Knockout play-offs (seeded)',
  'ko-unseeded':'Knockout play-offs (unseeded)',
  'rel-po':     'Relegation play-off',
  'relegation': 'Relegation',
  'eliminated': 'Eliminated',
  'other':      'Other'
};

window.zoneFor = function (description) {
  var d = (description || '').toLowerCase();
  if (!d) return null;
  if (d.indexOf('round of 16') !== -1) return 'r16';
  if (d.indexOf('unseeded') !== -1) return 'ko-unseeded';
  if (d.indexOf('seeded') !== -1) return 'ko-seeded';
  if (d.indexOf('eliminated') !== -1) return 'eliminated';
  if (d.indexOf('champions league') !== -1) return d.indexOf('qualif') !== -1 ? 'ucl-q' : 'ucl';
  if (d.indexOf('europa league') !== -1) return d.indexOf('qualif') !== -1 ? 'uel-q' : 'uel';
  if (d.indexOf('conference') !== -1) return d.indexOf('qualif') !== -1 ? 'uecl-q' : 'uecl';
  if (d.indexOf('promotion') !== -1) return d.indexOf('playoff') !== -1 || d.indexOf('play-off') !== -1 ? 'promo-po' : 'promotion';
  if (d.indexOf('relegat') !== -1) return d.indexOf('playoff') !== -1 || d.indexOf('play-off') !== -1 ? 'rel-po' : 'relegation';
  return 'other';
};
