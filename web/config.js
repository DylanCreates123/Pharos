export const defaults = {
  location: 'Brisbane', zone: 'Australia/Brisbane', origin: 'Wooloowin', destination: '',
  team: '', theme: 'dark', wallpaper: 'nasa-daily', palette: 'wallpaper', mode: 'demo', weatherMode: 'default', transportMode: 'default', nbaMode: 'default', sharesMode: 'live', shares: 3600, demo_clock: '', weather: 900, transport: 300,
  departures: 60, nba: 1800, performance: 0, showWeather: true, showTransport: true, showNba: true
};
export const limits = {weather: [60,7200], transport: [60,7200], departures: [60,7200], nba: [120,7200]};
export function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem('pharos.' + key)) ?? fallback; }
  catch { return fallback; }
}
export function save(key, value) { localStorage.setItem('pharos.' + key, JSON.stringify(value)); }
export function refreshInterval(key, config) {
  const base = Number(config[key]);
  const minimum = limits[key][0];
  const progress = Math.max(0,Math.min(100,Number(config.performance) || 0))/100;
  return Math.max(minimum,Math.round(base+(minimum-base)*progress));
}
export function requirements(page, config) {
  const home = page === 'Home';
  return [
    ['weather', home && config.showWeather || page === 'Weather', refreshInterval('weather',config), ['location']],
    ['transport', home && config.showTransport || page === 'Transport',
      refreshInterval(home ? 'transport' : 'departures',config), ['origin','destination']],
    ['shares', home, 3600, []],
    ['nba', home && config.showNba || page === 'NBA', refreshInterval('nba',config), ['zone']]
  ].filter(([, enabled]) => enabled).map(([kind,,age,fields]) => {
    const override = config[kind + 'Mode'];
    const mode = override && override !== 'default' ? override : config.mode;
    const params = new URLSearchParams({mode});
    if (kind === 'nba') params.set('score_version','2');
    for (const field of fields) params.set(field, config[field]);
    if (mode === 'demo' && config.demo_clock) {
      params.set('demo_clock', String(Math.floor(Date.parse(config.demo_clock + 'Z')/1000)));
    }
    return {kind, age, key: kind + '?' + params};
  }).concat(config.wallpaper?.startsWith('nasa-') ? [{
    kind:'wallpaper',age:86400,key:'wallpaper/'+config.wallpaper.slice(5)
  }] : []);
}
