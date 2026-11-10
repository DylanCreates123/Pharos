export const defaults = {
  location: 'Brisbane', zone: 'Australia/Brisbane', origin: 'Wooloowin', destination: '',
  team: '', theme: 'dark', mode: 'demo', weatherMode: 'default', transportMode: 'default', nbaMode: 'default', demo_clock: '', weather: 900, transport: 300,
  departures: 60, nba: 1800, showWeather: true, showTransport: true, showNba: true
};
export const limits = {weather: [60,7200], transport: [60,7200], departures: [60,7200], nba: [120,7200]};
export function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem('pharos.' + key)) ?? fallback; }
  catch { return fallback; }
}
export function save(key, value) { localStorage.setItem('pharos.' + key, JSON.stringify(value)); }
export function requirements(page, config) {
  const home = page === 'Home';
  return [
    ['weather', home && config.showWeather || page === 'Weather', config.weather, ['location']],
    ['transport', home && config.showTransport || page === 'Transport',
      home ? config.transport : config.departures, ['origin','destination']],
    ['nba', home && config.showNba || page === 'NBA', config.nba, ['zone']]
  ].filter(([, enabled]) => enabled).map(([kind,,age,fields]) => {
    const override = config[kind + 'Mode'];
    const mode = override && override !== 'default' ? override : config.mode;
    const params = new URLSearchParams({mode});
    for (const field of fields) params.set(field, config[field]);
    if (mode === 'demo' && config.demo_clock) {
      params.set('demo_clock', String(Math.floor(Date.parse(config.demo_clock + 'Z')/1000)));
    }
    return {kind, age, key: kind + '?' + params};
  });
}
