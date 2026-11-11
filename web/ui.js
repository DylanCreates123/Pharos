import {stations, teams} from './preferences.js';
import {defaults, limits, read, save, requirements, refreshInterval} from './config.js';
import {Coordinator} from './coordinator.js';
import {agenda, zoneInput} from './local.js';

const screens = ['Home','Timers','Transport','Agenda','NBA','Settings'];
const config = {...defaults,...read('settings',{})};
const screen = document.querySelector('#screen');
const nav = document.querySelector('#nav');
const coordinator = new Coordinator(drawData);
let page, active = [];
const nbaPages = {Today:0, Tomorrow:0};

let clockTools = false;
const dial = read("clockDial", {duration:0, elapsed:0, started:null});
const elapsed = now => dial.elapsed + (dial.started === null ? 0 : Math.max(0, now - dial.started));
const saveDial = () => save("clockDial", dial);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const button = (label, action, value = '') =>
  '<button type="button" data-action="'+action+'" data-value="'+esc(value)+'">'+label+'</button>';
const format = (time, options) => new Intl.DateTimeFormat('en-AU',{timeZone:config.zone,...options}).format(time);
const timeText = time => format(time,{hour:'numeric',minute:'2-digit'});
const stamp = time => format(time,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const title = (name, caption = '') => '<p class="eyebrow">PHAROS / '+name.toUpperCase()+'</p><h1>'+name+
  '</h1><p class="muted">'+caption+'</p>';
const dataPanel = kind => '<div data-dataset="'+kind+'"></div>';
const card = (name, content, target, extra = '') => '<article class="'+extra+'"><h2>'+name+
  '</h2>'+content+(target ? ('<button type="button" class="card-hit" data-action="go" data-value="'+esc(target)+'" aria-label="Open '+esc(target)+'"></button>') : '')+'</article>';
const openAgenda = () => agenda.filter(item => !item.done).sort((a,b) => a.due-b.due);

function agendaSummary() {
  return openAgenda().slice(0,2).map(item => '<div class="data-line">'+esc(item.title)+
    '<small>'+esc(item.subject)+' · '+stamp(item.due)+'</small></div>').join('') ||
    '<p class="muted">No upcoming assessments</p>';
}

function home() {
  return '<section class="dashboard">'+
    card('Desk clock','<div id="clock" class="clock number"></div><small data-timezone>'+esc(config.zone)+'</small><p id="home-timer" class="home-timer number" hidden></p>'+'<section class="share-strip" data-dataset="shares" aria-label="ASX quotes in Australian dollars"></section>','Timers','hero')+
    (config.showWeather ? card('Weather',dataPanel('weather'),'Weather','home-weather') : '')+
    card('University',agendaSummary(),'Agenda','home-summary')+
    (config.showTransport ? card('Departures',dataPanel('transport'),'Transport','home-summary') : '')+
    (config.showNba ? card('NBA',dataPanel('nba'),'NBA','home-summary') : '')+
    '</section>';
}

function timerView() {
  if (!clockTools) {
    return '<section class="clock-face"><button type="button" class="clock-display number" '+
      'data-action="clock-tools" aria-label="Open timer and stopwatch"><span id="clock"></span></button></section>';
  }
  const wheel = (unit, label) => '<div data-wheel="'+unit+'" role="spinbutton" tabindex="0" '+
    'aria-label="'+label+'" aria-valuemin="0" aria-valuemax="'+(unit === 'minutes' ? '99' : '59')+'" aria-valuenow="0">00</div>';
  return '<section class="clock-face clock-tools"><button type="button" class="clock-back" '+
    'data-action="clock-back" aria-label="Show clock"><span id="clock" class="number"></span></button><div class="dial number">'+wheel('minutes','Minutes')+
    '<span aria-hidden="true">:</span>'+wheel('seconds','Seconds')+'</div>'+
    '<p id="clock-mode" class="muted"></p><div class="clock-actions">'+
    button('Start','clock-start')+button('Stop','clock-stop')+button('Reset','clock-reset')+'</div>'+
    '<small>Swipe up or down on either number to set a timer. Leave both at zero for a stopwatch.</small></section>';
}

function updateDial(now) {
  const minutes = screen.querySelector('[data-wheel="minutes"]');
  if (!minutes) return;
  const seconds = screen.querySelector('[data-wheel="seconds"]');
  let progress = elapsed(now);
  const completed = dial.duration > 0 && progress >= dial.duration;
  if (completed && dial.started !== null) {
    dial.elapsed = dial.duration;
    dial.started = null;
    saveDial();
    progress = dial.elapsed;
  }
  const value = dial.duration ? Math.ceil(Math.max(0,dial.duration-progress)/1000) : Math.floor(progress/1000);
  for (const [wheel, part] of [[minutes,Math.floor(value/60)],[seconds,value%60]]) {
    const label = String(part).padStart(2,'0');
    if (wheel.textContent !== label) wheel.textContent = label;
    wheel.setAttribute('aria-valuenow',part);
    wheel.setAttribute('aria-disabled',String(dial.started !== null));
  }
  const status = screen.querySelector('#clock-mode');
  const label = completed ? 'Timer complete' : dial.duration ? 'Countdown timer' : 'Stopwatch';
  if (status.textContent !== label) status.textContent = label;
  screen.querySelector('[data-action="clock-start"]').disabled = dial.started !== null;
  screen.querySelector('[data-action="clock-stop"]').disabled = dial.started === null;
}

function adjustDial(unit, delta) {
  if (dial.started !== null || !delta) return;
  const total = dial.duration / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const next = unit === 'minutes' ? Math.max(0,Math.min(99,minutes+delta))*60 + seconds
    : Math.max(0,Math.min(5999,total+delta));
  dial.duration = next*1000;
  dial.elapsed = 0;
  saveDial();
  updateDial(Date.now());
}

function agendaView() {
  const upcoming = openAgenda().slice(0,2);
  const cards = Array.from({length:2},(_,index) => {
    const item = upcoming[index];
    const content = item
      ? '<h2>'+esc(item.title)+'</h2><p class="muted">'+esc(item.subject)+'</p><p>'+stamp(item.due)+'</p>'
      : '<p class="agenda-empty">Nothing planned</p>';
    return '<article class="agenda-card"><p class="eyebrow">'+(index === 0 ? 'UP NEXT' : 'AFTER THAT')+
      '</p>'+content+'</article>';
  });
  return '<h1>Agenda</h1><section class="agenda-cards" aria-label="Upcoming plans">'+cards.join('')+'</section>';
}

const settingsPages = {
  'Settings/Display': ['Display', ''],
  'Settings/Data': ['Data & connections', ''],
  'Settings/Power': ['Power', 'Exit Pharos or shut down the Pi'],
  'Settings/About': ['Diagnostics & sources', 'Request counts and data credits'],
  'Settings/Providers': ['Provider options', ''],
  'Settings/Space': ['Space Themes', 'NASA imagery for your desk']
};

function settings() {
  const tile = (route, heading) =>
    '<button class="settings-tile" type="button" data-action="go" data-value="'+route+'">'+
    '<span class="settings-tile-title">'+heading+'</span></button>';
  return '<div class="settings-page settings-hub"><h1>Settings</h1>'+
    '<section class="settings-hub-grid" aria-label="Settings categories">'+
    Object.entries(settingsPages).filter(([route]) => !['Settings/Providers','Settings/Space'].includes(route)).map(([route,[heading]]) => tile(route,heading)).join('')+
    '</section></div>';
}

function settingsDetail() {
  const input = (key,label,attrs='') => '<label>'+label+'<input name="'+key+'" value="'+esc(config[key])+'" '+attrs+'></label>';
  const select = (key,label,options) => '<label>'+label+'<select name="'+key+'">'+
    options.map(value => '<option'+(config[key]===value ? ' selected' : '')+'>'+value+'</option>').join('')+'</select></label>';
  const picker = (key,label,options) => {
    const selected = config[key].trim();
    const values = options.map(([value,name]) => ({value,name}));
    const match = values.find(option => option.value.toLowerCase() === selected.toLowerCase()
      || (key === 'destination' && (option.value+' station').toLowerCase() === selected.toLowerCase()));
    if (!match && selected) values.push({value:selected,name:selected});
    const current = match?.value ?? selected;
    return '<label>'+label+'<select name="'+key+'" aria-label="'+label+'">'+
      values.map(({value,name}) => '<option value="'+esc(value)+'"'+(value === current ? ' selected' : '')+
        '>'+esc(name)+'</option>').join('')+'</select></label>';
  };
  const check = (key,label) => '<label class="home-card-toggle">'+
    '<input name="'+key+'" type="checkbox" aria-label="'+label+' on Home"'+(config[key] ? ' checked' : '')+'>'+
    '<strong>'+label+'</strong><span class="home-card-state">'+(config[key] ? 'On' : 'Off')+'</span></label>';
  const group = (heading,description,content,layout='settings-fields') =>
    '<section class="settings-group"><h2>'+heading+'</h2>'+
    (description ? '<p class="muted">'+description+'</p>' : '')+
    '<div class="'+layout+'">'+content+'</div></section>';
  const choices = (key,options) => options.map(([value,label]) =>
    '<label class="appearance-choice" data-preview="'+key+'-'+value+'">'+
    '<input type="radio" name="'+key+'" value="'+value+'"'+(config[key] === value ? ' checked' : '')+'>'+
    '<span>'+label+'</span></label>').join('');
  const modes = ['default','demo','live'];
  const [heading,description] = settingsPages[page];
  let content;
  if (page === 'Settings/Display') {
    content = group('Appearance','',
      '<div class="appearance-actions"><button type="button" class="theme-toggle" data-action="theme-toggle" data-theme="'+config.theme+
      '" aria-label="Theme: '+(config.theme === 'light' ? 'Light' : 'Dark')+'">'+
      (config.theme === 'light' ? 'Light' : 'Dark')+'</button>'+
      '<button type="button" data-action="appearance-options" data-value="wallpapers" aria-expanded="false" aria-controls="wallpaper-options">Wallpapers</button>'+
      '<button type="button" data-action="appearance-options" data-value="themes" aria-expanded="false" aria-controls="theme-options">Themes</button></div>'+
      '<div id="wallpaper-options" class="appearance-options" hidden><h3>Wallpapers</h3><div class="appearance-choices">'+
      choices('wallpaper',[['none','Plain'],['horizon','Horizon'],['grid','Grid']])+
      '<button type="button" class="appearance-choice space-link" data-action="go" data-value="Settings/Space">Space ↗</button></div></div>'+
      '<div id="theme-options" class="appearance-options" hidden><h3>Themes</h3><div class="appearance-choices">'+
      choices('palette',[['wallpaper','Match wallpaper'],['teal','Teal'],['blue','Blue'],['violet','Violet'],['amber','Amber']])+'</div></div>','theme-controls')+
      group('Home cards','',
      check('showWeather','Weather')+check('showTransport','Departures')+check('showNba','NBA'),'home-card-controls');
  }
  if (page === 'Settings/Data') {
    content = group('Preferences','',
      input('location','Weather location','required maxlength="80"')+
      input('origin','Train origin','required maxlength="80"')+
      picker('destination','Destination station', [['','All destinations'],...stations.map(name => [name,name])])+
      picker('team','Favourite NBA team', [['','All teams'],...teams]))+
      group('Providers','',
      '<div class="provider-controls"><button type="button" class="provider-mode" data-action="provider-mode" '+
      'data-mode="'+config.mode+'" aria-label="All providers: '+(config.mode === 'live' ? 'Live' : 'Demo')+'">'+
      (config.mode === 'live' ? 'Live' : 'Demo')+'</button>'+button('More','go','Settings/Providers')+'</div>'+
      (['weatherMode','transportMode','nbaMode','sharesMode'].some(key =>
        config[key] !== 'default' && config[key] !== config.mode)
        ? '<small>Some providers have individual settings.</small>' : ''),'provider-options');
  }
  if (page === 'Settings/Space') {
    return '<div class="settings-page settings-detail space-page"><div class="settings-detail-heading">'+
      button('‹ Display','go','Settings/Display')+'<h1>Space Themes</h1></div>'+
      '<form class="settings-form" data-form="settings"><div class="space-options">'+
      choices('wallpaper',[['nasa-daily','NASA Daily'],['nasa-nebula','Nebulae'],
        ['nasa-earth','Earth'],['nasa-planets','Planets']])+'</div>'+
      '<p class="status" role="status"></p><div id="space-credit" class="space-credit"></div></form></div>';
  }
  if (page === 'Settings/Providers') {
    content = group('Individual feeds','',
      select('weatherMode','Weather',modes)+select('transportMode','Trains',modes)+
      select('nbaMode','NBA',modes)+select('sharesMode','ASX shares',modes));
  }
  if (page === 'Settings/Power') {
    return '<div class="settings-page settings-detail"><h1>Power</h1>'+
      '<div class="power-controls">'+button('Back','go','Settings')+
      button('Exit','power','exit')+button('Shutdown','power','shutdown')+'</div>'+
      '<p class="status power-status" role="status"></p></div>';
  }
  if (page === 'Settings/About') {
    return '<div class="settings-page settings-detail">'+
      '<div class="settings-detail-heading">'+button('‹ Settings','go','Settings')+'<h1>'+heading+'</h1></div>'+
      '<form class="settings-form performance-panel" data-form="settings">'+
      '<section class="settings-group"><h2>Refresh performance</h2>'+
      '<label class="performance-slider">Update speed<input name="performance" type="range" min="0" max="100" step="1" '+
      'value="'+config.performance+'" aria-label="Refresh performance" style="--progress:'+config.performance+'%;--slider-colour:hsl('+(210-config.performance*0.8)+' 55% 55%)"></label>'+
      '<div class="performance-labels"><span>Normal</span><div id="performance-rates" class="muted">'+
      performanceRates(config)+'</div><span>Live</span></div>'+
      '<p class="status" role="status"></p></section></form>'+
      '<div class="settings-grid">'+group('Diagnostics','API calls since server startup. Updated on opening.',
        '<div id="diagnostics" role="status">Loading counts…</div>','diagnostics-content')+
      group('Data sources','Credits and reference links.',
        '<p><a href="https://open-meteo.com/">Open-Meteo</a> · Weather</p>'+
        '<p><a href="https://translink.com.au/about-translink/open-data">Translink</a> · Rail · '+
        '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p>'+
        '<p><a href="https://docs.balldontlie.io/">BALLDONTLIE</a> · NBA</p>'+
        '<p><a href="https://eodhd.com/">EODHD</a> · Delayed ASX quotes</p>','settings-sources')+
      '</div></div>';
  }
  return '<div class="settings-page settings-detail"><div class="settings-detail-heading">'+
    button(page === 'Settings/Providers' ? '‹ Data & connections' : '‹ Settings','go',
      page === 'Settings/Providers' ? 'Settings/Data' : 'Settings')+'<h1>'+heading+'</h1></div>'+
    (description ? '<p class="muted">'+description+'</p>' : '')+
    '<form class="settings-form" data-form="settings"><div class="settings-save">'+
    '<p class="status" role="status">'+(description ? 'Changes save automatically.' : '')+'</p></div>'+
    '<div class="settings-grid '+(page === 'Settings/Data' ? 'settings-data-grid' : '')+'">'+content+'</div></form></div>';
}

function performanceRates(settings) {
  const interval = key => {
    const seconds = refreshInterval(key,settings);
    return seconds >= 60 && seconds%60 === 0 ? seconds/60+' min' : seconds+' sec';
  };
  return '<span>Weather '+interval('weather')+' · NBA '+interval('nba')+'</span>';
}

screen.addEventListener('input',event => {
  const slider = event.target;
  if (slider.name !== 'performance') return;
  slider.style.setProperty('--progress',slider.value+'%');
  slider.style.setProperty('--slider-colour','hsl('+(210-Number(slider.value)*0.8)+' 55% 55%)');
  document.querySelector('#performance-rates').innerHTML = performanceRates({...config,performance:Number(slider.value)});
});

function weatherForecast(payload) {
  const degrees = value => value == null ? '—' : esc(value)+'°';
  const metric = (label,value) => '<div><dt>'+label+'</dt><dd>'+value+'</dd></div>';
  const day = (heading,data) => '<section class="weather-day"><h2>'+heading+'</h2>'+
    (data ? '<p class="muted">'+esc(data.condition)+'</p><dl class="weather-metrics">'+
      metric('High',degrees(data.high))+metric('Low',degrees(data.low))+
      metric('Rain chance',data.rain == null ? '—' : esc(data.rain)+'%')+'</dl>'
      : '<p class="muted">Forecast unavailable</p>')+'</section>';
  return '<section class="weather-current"><div><p class="eyebrow">CURRENT WEATHER</p>'+
    '<h2>'+esc(payload.location)+'</h2><p>'+esc(payload.condition)+'</p></div>'+
    '<p class="weather-temperature number">'+degrees(payload.temp)+(payload.temp == null ? '' : 'C')+
    '</p></section><div class="weather-days">'+day('Today',payload)+day('Tomorrow',payload.tomorrow)+'</div>';
}

let sampledWallpaper = '';
function tintFromWallpaper(url) {
  if (sampledWallpaper === url) return;
  sampledWallpaper = url;
  const image = new Image();
  image.onload = () => {
    if (sampledWallpaper !== url) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 12;
      const context = canvas.getContext('2d',{willReadFrequently:true});
      context.drawImage(image,0,0,12,12);
      const pixels = context.getImageData(0,0,12,12).data;
      const totals = [0,0,0];
      let weightSum = 0;
      for (let i=0;i<pixels.length;i+=4) {
        const brightness = Math.max(pixels[i],pixels[i+1],pixels[i+2]);
        const weight = brightness/255;
        for (let channel=0;channel<3;channel++) totals[channel] += pixels[i+channel]*weight;
        weightSum += weight;
      }
      if (!weightSum) return;
      const colour = totals.map(total => Math.round(total/weightSum)).join(' ');
      document.body.style.setProperty('--wallpaper-tint','rgb('+colour+')');
    } catch { /* Keep the default space tint if sampling is unavailable. */ }
  };
  image.onerror = () => { if (sampledWallpaper === url) sampledWallpaper = ''; };
  image.src = url;
}

function applySpaceWallpaper(record) {
  const saved = record?.payload ?? read('lastWallpaper',null);
  if (saved?.url && /^\/wallpapers\/[a-f0-9]+\.(jpg|png|webp)$/.test(saved.url)) {
    document.body.style.setProperty('--space-image','url("'+saved.url+'")');
    tintFromWallpaper(saved.url);
    if (record?.payload && read('lastWallpaper',null)?.url !== record.payload.url) {
      try { save('lastWallpaper',record.payload); } catch { /* The image can still display. */ }
    }
  }
  const preview = record?.payload && document.querySelector('[data-preview="wallpaper-nasa-'+record.payload.collection+'"]');
  if (preview && /^\/wallpapers\/[a-f0-9]+\.(jpg|png|webp)$/.test(record.payload.url)) {
    preview.style.backgroundImage = 'url("'+record.payload.url+'")';
  }
  const credit = document.querySelector('#space-credit');
  if (credit) {
    const valid = record?.payload;
    let markup = valid ? '<p><strong>'+esc(valid.title)+'</strong></p><small>'+
      esc(valid.credit)+' · '+esc(valid.date)+' · <a href="'+esc(valid.source)+'" target="_blank" rel="noopener noreferrer">NASA source</a></small>'
      : config.wallpaper.startsWith('nasa-') ? '<p class="muted">'+esc(record?.error || 'Loading NASA image…')+'</p>' : '';
    if (valid && record.error) markup += '<small>'+esc(record.error)+'</small>';
    if (credit.dataset.rendered !== markup) {
      credit.innerHTML = markup;
      credit.dataset.rendered = markup;
    }
  }
}

function drawData() {
  for (const req of active) {
    const record = coordinator.record(req);
    if (req.kind === 'wallpaper') {
      applySpaceWallpaper(record);
      continue;
    }
    const panel = screen.querySelector('[data-dataset="'+req.kind+'"]');
    if (!panel) continue;
    const busy = coordinator.pending.has(req.key);
    const payload = record?.payload;
    if (req.kind === 'shares') {
      const demo = req.key.includes('mode=demo');
      const quotes = (payload ?? []).map(({symbol,price,change}) => {
        const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
        const sign = change > 0 ? '+' : change < 0 ? '−' : '';
        return '<li><strong>'+esc(symbol)+'</strong> $'+Number(price).toFixed(2)+
          ' <span class="share-change" data-direction="'+direction+'">'+sign+Math.abs(change).toFixed(1)+'%</span></li>';
      }).join('');
      const unavailable = record?.error || (busy ? 'Loading quotes…' : 'Quotes unavailable');
      const html = quotes ? '<ul>'+quotes+'</ul>' : '<span class="muted">'+esc(unavailable)+'</span>';
      panel.setAttribute('aria-label',demo ? 'Demo ASX quotes in Australian dollars' : 'Delayed ASX quotes in Australian dollars');
      if (panel.dataset.rendered !== html) {
        panel.innerHTML = html;
        panel.dataset.rendered = html;
      }
      continue;
    }
    const now = Date.now()/1000;
    const due = Math.max(record?.retry_at ?? 0, coordinator.retry.get(req.key) ?? 0);
    const isDemo = new URLSearchParams(req.key.split('?')[1]).get('mode') === 'demo';
    const demoNow = isDemo && config.demo_clock && record?.fetched_at
      ? record.source_at + now - record.fetched_at : now;
    let content = '<p class="muted">'+(busy ? 'Loading…' : record?.error || 'No data yet')+'</p>';
    if (payload && req.kind === 'weather') {
      content = page === 'Weather' ? weatherForecast(payload) : '<p class="big">'+payload.temp+'°C</p><p>'+esc(payload.condition)+'</p><small>'+
        esc(payload.location)+' · H '+payload.high+'° · L '+payload.low+'° · Rain '+(payload.rain == null ? 'unavailable' : payload.rain+'%')+'</small>';
    }
    if (payload && req.kind === 'transport') {
      const summary = page === 'Home';
      const walkMinutes = 5;
      const upcoming = payload.filter(train => train.at > demoNow &&
        (String(train.platform) === '1' && train.at-demoNow >= walkMinutes*60))
        .sort((a,b) => a.at-b.at).slice(0,2);
      const route = esc(config.origin)+(config.destination ? ' → '+esc(config.destination) : ' · All destinations');
      const departures = upcoming.map(train => {
        const platform = train.platform ? 'Platform '+esc(train.platform) : '';
        const enoughTime = train.at-demoNow >= walkMinutes*60;
        const predictionAt = train.prediction_at ?? record?.fetched_at;
        const fresh = predictionAt != null && now-predictionAt >= 0 && now-predictionAt < 120;
        const reliable = train.prediction && fresh && !record?.error && enoughTime;
        const reason = !enoughTime ? 'Less than five minutes to walk'
          : reliable ? 'Fresh prediction with time for the five-minute walk' : 'Departure time is uncertain';
        const minutes = '<span class="train-countdown" data-confidence="'+(reliable ? 'good' : 'uncertain')+
          '" title="'+reason+'" aria-label="'+Math.ceil((train.at-demoNow)/60)+' minutes. '+reason+'">'+
          Math.ceil((train.at-demoNow)/60)+' min</span>';
        const time = timeText(train.at*1000);
        const destination = train.headsign ? ' · '+esc(train.headsign) : '';
        if (summary) {
          return '<div class="data-line"><strong>'+minutes+'</strong> · '+time+
            (platform ? ' · '+platform : '')+(destination ? '<small>'+esc(train.headsign)+'</small>' : '')+'</div>';
        }
        const leaveIn = Math.floor((train.at-demoNow)/60)-walkMinutes;
        const leave = leaveIn > 0 ? 'Leave in '+leaveIn+' min' : 'Leave now';
        return '<section class="departure-card"><h2>'+leave+'</h2>'+
          '<p class="big number">Train in '+minutes+'</p><p>'+time+destination+'</p></section>';
      }).join('');
      const empty = '<p class="muted">No reachable departures from Platform 1</p>';
      content = '<p>'+route+'</p>'+(!summary ? '<p class="muted">Platform 1 · '+walkMinutes+' min walk</p>' : '')+
        (departures && !summary ? '<div class="departure-cards">'+departures+'</div>' : departures || empty);
    }
    if (payload && req.kind === 'nba') {
      const dayKey = at => zoneInput(at,config.zone).slice(0,10);
      const current = demoNow*1000;
      const today = dayKey(current);
      const dateOnly = new Intl.DateTimeFormat('en-AU',{
        timeZone:'UTC',weekday:'short',day:'numeric',month:'short'
      });
      const todayDate = Date.parse(today+'T00:00:00Z');
      const tomorrowDate = todayDate + 86400000;
      const tomorrow = new Date(tomorrowDate).toISOString().slice(0,10);
      const games = payload.filter(game => [today,tomorrow].includes(dayKey(game.at*1000)));
      const matches = (game, team) => !team || game.home === team || game.away === team;
      const result = game => {
        if (game.state === 'in_progress') return game.score ? esc(game.score) : 'In progress';
        return game.score ? 'Final '+esc(game.score) : '';
      };
      const line = (game, showDay = false) => '<div class="data-line"><strong>'+esc(game.away)+' @ '+esc(game.home)+
        '</strong><small>'+(showDay ? (dayKey(game.at*1000) === today ? 'Today · ' : 'Tomorrow · ') : '')+
        (result(game) || timeText(game.at*1000))+'</small></div>';
      if (page === 'Home') {
        const featured = team => {
          const matching = games.filter(game => matches(game,team));
          return matching.find(game => dayKey(game.at*1000) === today)
            ?? matching.find(game => !game.score && game.at > demoNow);
        };
        const next = featured(config.team);
        const okc = featured('OKC');
        const okcToday = okc && dayKey(okc.at*1000) === today;
        content = (next ? line(next,true) : '<p class="muted">No games today or tomorrow</p>')+
          '<div class="nba-okc"><h3>'+(okcToday ? 'OKC today' : 'Next OKC game')+'</h3>'+
          (okc ? line(okc,true) : '<small>No game today or tomorrow</small>')+'</div>';
      } else {
        const cardTop = panel.getBoundingClientRect().top + window.scrollY;
        const bottomPadding = parseFloat(getComputedStyle(screen).paddingBottom);
        const available = window.innerHeight - nav.offsetHeight - cardTop - bottomPadding;
        const gamesPerPage = Math.max(1,Math.min(7,Math.floor((available-158)/36)));
        const group = (heading, key, date) => {
          const dayGames = games.filter(game => dayKey(game.at*1000) === key && matches(game,config.team));
          const pages = Math.max(1,Math.ceil(dayGames.length/gamesPerPage));
          const index = Math.min(nbaPages[heading],pages-1);
          nbaPages[heading] = index;
          const rows = dayGames.slice(index*gamesPerPage,(index+1)*gamesPerPage).map(game =>
            '<li><strong>'+esc(game.away)+' @ '+esc(game.home)+'</strong><span>'+
            (result(game) || timeText(game.at*1000))+'</span></li>').join('');
          return '<section class="nba-day"><header class="nba-day-heading"><h2>'+heading+
            '</h2><span>'+dateOnly.format(date)+'</span></header>'+
            (rows ? '<ul class="nba-games">'+rows+'</ul>' : '<p class="nba-empty muted">No games scheduled</p>')+
            (pages > 1 ? '<div class="nba-pager">'+
              '<button type="button" data-action="nba-page" data-value="'+heading+':-1" aria-label="Previous '+heading.toLowerCase()+' games"'+
              (index === 0 ? ' disabled' : '')+'>‹</button><span>'+(index+1)+' / '+pages+'</span>'+
              '<button type="button" data-action="nba-page" data-value="'+heading+':1" aria-label="Next '+heading.toLowerCase()+' games"'+
              (index === pages-1 ? ' disabled' : '')+'>›</button></div>' : '')+'</section>';
        };
        content = '<div class="nba-days">'+group('Today',today,todayDate)+group('Tomorrow',tomorrow,tomorrowDate)+'</div>';
      }
    }
    const status = isDemo ? ['Demo data'] : [];
    if (record?.fetched_at != null) {
      const expiry = req.kind === 'transport' ? 120 : req.age;
      if (req.kind !== 'transport' && now-record.fetched_at >= expiry) status.push('Outdated');
    }
    if (record?.error) status.push(record.error);
    if (busy) status.push('Refreshing…');
    else if (due > now) status.push('Next retry in '+Math.ceil(due-now)+'s');
    const body = panel.querySelector('.data-content');
    if (body.dataset.rendered !== content) {
      body.innerHTML = content;
      body.dataset.rendered = content;
    }
    panel.querySelector('.data-status').textContent = status.join(' · ');
  }
}

function tick() {
  const now = Date.now();
  document.querySelector('#date').textContent = format(now,{weekday:'long',day:'numeric',month:'long'});
  const clock = document.querySelector('#clock');
  screen.querySelectorAll('[data-timezone]').forEach(label => { if (label.textContent !== config.zone) label.textContent = config.zone; });
  if (clock) clock.textContent = format(now,{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:false});
  if (page === 'Timers') updateDial(now);
  const homeTimer = screen.querySelector('#home-timer');
  if (homeTimer) {
    const progress = elapsed(now);
    const complete = dial.duration > 0 && progress >= dial.duration;
    homeTimer.hidden = dial.started === null && dial.elapsed === 0;
    if (!homeTimer.hidden) {
      const seconds = dial.duration ? Math.ceil(Math.max(0,dial.duration-progress)/1000) : Math.floor(progress/1000);
      const time = String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
      const label = complete ? 'Timer complete' :
        (dial.duration ? 'Timer remaining' : 'Stopwatch')+' · '+time+(dial.started === null ? ' · Paused' : '');
      if (homeTimer.textContent !== label) homeTimer.textContent = label;
    }
  }
}

function applyAppearance() {
  document.body.classList.toggle('light',config.theme === 'light');
  document.body.dataset.wallpaper = config.wallpaper;
  document.body.dataset.palette = config.palette;
  if (config.wallpaper.startsWith('nasa-')) {
    const req = requirements(page,config).find(req => req.kind === 'wallpaper');
    applySpaceWallpaper(coordinator.record(req));
  } else {
    document.body.style.removeProperty('--space-image');
  }
  const feeds = ['weatherMode','transportMode','nbaMode','sharesMode'];
  const modes = feeds.map(key => config[key] === 'default' ? config.mode : config[key]);
  const mode = modes.every(value => value === 'live') ? 'live' : 'demo';
  const label = modes.every(value => value === 'demo') ? 'Demo data'
    : mode === 'live' ? 'Live data' : 'Mixed live and demo data';
  const dot = document.querySelector('body > header i');
  dot.dataset.mode = mode;
  dot.setAttribute('role','img');
  dot.setAttribute('aria-label',label);
  dot.title = label;
}

function show(target) {
  page = screens.includes(target) || target === 'Weather' || Object.hasOwn(settingsPages,target) ? target : 'Home';
  active = requirements(page,config);
  applyAppearance();
  nav.innerHTML = screens.map(name => name === 'Settings'
    ? '<button type="button" class="settings-gear" data-action="go" data-value="Settings" aria-label="Settings"><span aria-hidden="true">⚙︎</span></button>'
    : button(name === 'Timers' ? 'Clock' : name,'go',name)).join('');
  nav.querySelector('[data-value="'+(Object.hasOwn(settingsPages,page) ? 'Settings' : page === 'Weather' ? 'Home' : page)+'"]').setAttribute('aria-current','page');
  const views = {Home:home,Timers:timerView,Agenda:agendaView,Settings:settings};
  for (const route of Object.keys(settingsPages)) views[route] = settingsDetail;
  screen.innerHTML = views[page] ? views[page]() : (['NBA','Weather','Transport'].includes(page) ? '<h1>'+page+'</h1>' : title(page))+
    (page === 'NBA' ? '<section class="nba-panel">'+dataPanel('nba')+'</section>' :
      page === 'Weather' ? '<section class="weather-panel">'+dataPanel('weather')+'</section>' :
      '<article>'+dataPanel(active[0].kind)+'</article>');
  for (const req of active) {
    if (['shares','wallpaper'].includes(req.kind)) continue;
    screen.querySelector('[data-dataset="'+req.kind+'"]').innerHTML =
      '<div class="data-content"></div><small class="data-status"></small>';
  }
  drawData();
  tick();
  coordinator.subscribe('screen',active);
  if (page === 'Settings/About') diagnostics();
}

async function diagnostics() {
  const element = document.querySelector('#diagnostics');
  if (!element) return;
  try {
    const response = await fetch('/api/diagnostics',{signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error();
    const counts = await response.json();
    const providers = [['weather','Weather'],['transport','Trains'],['nba','NBA'],['shares','Shares']];
    element.innerHTML = '<table class="diagnostics-table"><tbody>'+
      providers.map(([key,name]) => '<tr><th scope="row">'+name+'</th><td>'+
        esc(counts[key+'.requests'] ?? 0)+'</td></tr>').join('')+'</tbody></table>';
  } catch { element.textContent = 'Local server unreachable'; }
}

document.addEventListener('click',async event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const {action,value} = control.dataset;
  if (action === 'go') {
    if (value === 'Timers' && page === 'Timers') { clockTools = false; show(page); }
    else location.hash = value;
    return;
  }
  if (action === 'appearance-options') {
    const target = document.querySelector(value === 'wallpapers' ? '#wallpaper-options' : '#theme-options');
    const open = target.hidden;
    screen.querySelectorAll('.appearance-options').forEach(panel => { panel.hidden = true; });
    screen.querySelectorAll('[data-action="appearance-options"]').forEach(button => button.setAttribute('aria-expanded','false'));
    target.hidden = !open;
    control.setAttribute('aria-expanded',String(open));
    return;
  }
  if (action === 'power') {
    if (value === 'shutdown' && !window.confirm('Shut down the Raspberry Pi?')) return;
    const status = screen.querySelector('.power-status');
    const controls = screen.querySelectorAll('[data-action="power"]');
    controls.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/power/'+value,{method:'POST',signal:AbortSignal.timeout(5000)});
      if (response.status === 404) {
        status.textContent = 'Power controls are available on the configured Raspberry Pi.';
      } else if (response.ok) {
        status.textContent = value === 'shutdown' ? 'Shutting down the Pi…' : 'Exiting Pharos…';
        return;
      } else {
        status.textContent = 'Power action failed. Check the Pi kiosk setup.';
      }
    } catch {
      status.textContent = 'Could not reach the Pharos server.';
    }
    controls.forEach(button => { button.disabled = false; });
    return;
  }
  if (action === 'theme-toggle') {
    const next = {...config,theme:config.theme === 'light' ? 'dark' : 'light'};
    try { save('settings',next); }
    catch {
      screen.querySelector('[role="status"]').textContent = 'Theme could not be saved in this browser.';
      return;
    }
    Object.assign(config,next);
    applyAppearance();
    control.dataset.theme = config.theme;
    control.textContent = config.theme === 'light' ? 'Light' : 'Dark';
    control.setAttribute('aria-label','Theme: '+control.textContent);
    return;
  }
  if (action === 'provider-mode') {
    const next = {...config,mode:config.mode === 'live' ? 'demo' : 'live',
      weatherMode:'default',transportMode:'default',nbaMode:'default',sharesMode:'default'};
    try { save('settings',next); }
    catch {
      screen.querySelector('[role="status"]').textContent = 'Settings could not be saved in this browser.';
      return;
    }
    Object.assign(config,next);
    show(page);
    screen.querySelector('[data-action="provider-mode"]').focus({preventScroll:true});
    screen.querySelector('[role="status"]').textContent = 'All providers set to '+config.mode+'.';
    return;
  }
  if (action === 'nba-page') {
    const [day,direction] = value.split(':');
    nbaPages[day] += Number(direction);
    drawData();
    const controls = screen.querySelectorAll('[data-action="nba-page"]');
    const next = [...controls].find(item => item.dataset.value === value && !item.disabled)
      || [...controls].find(item => item.dataset.value.startsWith(day+':') && !item.disabled);
    next?.focus({preventScroll:true});
    return;
  }
  if (action === 'clock-tools' || action === 'clock-back') {
    clockTools = action === 'clock-tools';
    show(page);
    screen.querySelector(clockTools ? '[data-wheel]' : '.clock-display').focus({preventScroll:true});
    return;
  }
  if (['clock-start','clock-stop','clock-reset'].includes(action)) {
    const now = Date.now();
    if (action === 'clock-reset') {
      dial.elapsed = 0;
      dial.started = null;
    } else if (action === 'clock-start' && dial.started === null) {
      if (dial.duration && dial.elapsed >= dial.duration) dial.elapsed = 0;
      dial.started = now;
    } else if (action === 'clock-stop' && dial.started !== null) {
      dial.elapsed = elapsed(now);
      dial.started = null;
    }
    saveDial();
    updateDial(now);
    return;
  }

});

document.addEventListener('submit',event => {
  const form = event.target;
  event.preventDefault();

});

screen.addEventListener('change',async event => {
  const field = event.target;
  const form = field.closest('[data-form="settings"]');
  if (!form || !Object.hasOwn(defaults,field.name)) return;
  const status = form.querySelector('[role="status"]');
  const key = field.name;
  let value = field.type === 'checkbox' ? field.checked : field.value.trim();
  if (!field.reportValidity() || (field.required && value === '')) {
    status.textContent = 'Check ' + field.labels[0].textContent.trim() + '. The previous value is still saved.';
    return;
  }
  if (key === 'zone') {
    try { format(Date.now(),{timeZone:value}); }
    catch { status.textContent = 'Enter a valid timezone, such as Australia/Brisbane.'; return; }
  }
  if (key === 'demo_clock' && value) {
    const instant = Date.parse(value+'Z');
    if (!Number.isFinite(instant) || instant < 0 || instant > 4102444800000) {
      status.textContent = 'Choose a demo clock between 1970 and 2099.';
      return;
    }
  }
  if (Object.hasOwn(limits,key) || key === 'performance') value = Number(value);
  if (key === 'team') value = value.toUpperCase();
  let zone;
  if (key === 'location') {
    const version = ++locationVersion;
    status.textContent = 'Finding the location timezone…';
    try {
      zone = await locationTimezone(value);
      if (version !== locationVersion) return;
    } catch {
      if (version === locationVersion) status.textContent = 'Could not find that location. Check the name or try again when connected.';
      return;
    }
  }
  const next = {...config,[key]:value,...(key === 'wallpaper' && value.startsWith('nasa-') ? {palette:'wallpaper'} : {}),...(zone ? {zone,zoneLocation:value} : {})};
  try { save('settings',next); }
  catch { status.textContent = 'Settings could not be saved in this browser.'; return; }
  Object.assign(config,next);
  if (field.type === 'text') field.value = value;
  applyAppearance();
  if (key === 'wallpaper') {
    active = requirements(page,config);
    coordinator.subscribe('screen',active);
    drawData();
    if (value === 'none') {
      const credit = document.querySelector('#space-credit');
      if (credit) credit.innerHTML = '';
    }
  }
  const state = field.closest('.home-card-toggle')?.querySelector('.home-card-state');
  if (state) state.textContent = value ? 'On' : 'Off';
  status.textContent = 'Settings saved.';
});

let locationVersion = 0;
async function locationTimezone(location) {
  const response = await fetch('/api/location?'+new URLSearchParams({location}),{signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('Location unavailable');
  const record = await response.json();
  const zone = record.payload?.timezone;
  if (!zone) throw new Error('Timezone unavailable');
  new Intl.DateTimeFormat('en-AU',{timeZone:zone});
  return zone;
}
async function syncLocationTimezone() {
  if (config.zoneLocation === config.location) return;
  const location = config.location;
  const version = locationVersion;
  try {
    const zone = await locationTimezone(location);
    if (version !== locationVersion || config.location !== location) return;
    const next = {...config,zone,zoneLocation:location};
    save('settings',next);
    Object.assign(config,next);
    tick();
  } catch { /* Keep the last resolved timezone while disconnected. */ }
}

let touch;
screen.addEventListener('touchstart',event => {
  touch = event.target.closest('form,button,details,[data-wheel]') || event.touches.length !== 1 ? null : event.touches[0];
},{passive:true});
screen.addEventListener('touchend',event => {
  if (!touch) return;
  const end = event.changedTouches[0];
  const dx = end.clientX-touch.clientX;
  if (Math.abs(dx)>75 && Math.abs(dx)>1.5*Math.abs(end.clientY-touch.clientY)) {
    const index = Math.max(0,screens.indexOf(page));
    location.hash = screens[(index+(dx<0 ? 1 : -1)+screens.length)%screens.length];
  }
  touch = null;
},{passive:true});
window.addEventListener('hashchange',() => { clockTools = false; show(location.hash.slice(1)); });
document.addEventListener('visibilitychange',() => {
  coordinator.pause(document.hidden);
  if (!document.hidden) { tick(); drawData(); }
});
window.addEventListener('resize',() => { if (page === 'NBA') drawData(); });
coordinator.pause(document.hidden);
show(location.hash.slice(1));
setInterval(() => { if (!document.hidden) { tick(); drawData(); } },1000);
if ('serviceWorker' in navigator) {
  const workers = navigator.serviceWorker;
  let controlled = Boolean(workers.controller);
  workers.addEventListener('controllerchange',() => {
    if (controlled && !document.querySelector('#pharos-update')) {
      const update = document.createElement('button');
      update.id = 'pharos-update';
      update.type = 'button';
      update.textContent = 'Reload for update';
      update.addEventListener('click',() => window.location.reload());
      document.querySelector('body > header').append(update);
    }
    controlled = Boolean(workers.controller);
  });
  workers.register('/sw.js',{updateViaCache:'none'}).then(registration => {
    let checkedAt = 0;
    const check = () => {
      if (document.hidden || Date.now() - checkedAt < 5000) return;
      checkedAt = Date.now();
      registration.update().catch(() => {});
    };
    window.addEventListener('focus',check);
    window.addEventListener('hashchange',check);
    document.addEventListener('visibilitychange',check);
  }).catch(() => {});
}


screen.addEventListener('wheel',event => {
  const wheel = event.target.closest('[data-wheel]');
  if (!wheel) return;
  event.preventDefault();
  adjustDial(wheel.dataset.wheel,Math.sign(event.deltaY || event.deltaX));
},{passive:false});
screen.addEventListener('keydown',event => {
  const wheel = event.target.closest('[data-wheel]');
  if (!wheel || !['ArrowUp','ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  adjustDial(wheel.dataset.wheel,event.key === 'ArrowUp' ? 1 : -1);
});
let drag;
screen.addEventListener('pointerdown',event => {
  const wheel = event.target.closest('[data-wheel]');
  if (!wheel || dial.started !== null || !event.isPrimary) return;
  drag = {id:event.pointerId,y:event.clientY,wheel};
  wheel.setPointerCapture(event.pointerId);
});
screen.addEventListener('pointermove',event => {
  if (drag?.id !== event.pointerId) return;
  const steps = Math.trunc((drag.y-event.clientY)/22);
  if (!steps) return;
  drag.y -= steps*22;
  adjustDial(drag.wheel.dataset.wheel,steps);
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) {
  screen.addEventListener(name,event => { if (drag?.id === event.pointerId) drag = null; });
}
syncLocationTimezone();
