import {defaults, limits, read, save, requirements} from './config.js';
import {Coordinator} from './coordinator.js';
import {agenda, persistAgenda, zoneInput, fromZone} from './local.js';

const screens = ['Home','Timers','Transport','Agenda','NBA','Settings'];
const config = {...defaults,...read('settings',{})};
const screen = document.querySelector('#screen');
const nav = document.querySelector('#nav');
const coordinator = new Coordinator(drawData);
let page, editing, active = [];
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
    card('Desk clock','<div id="clock" class="clock number"></div><small>'+esc(config.zone)+'</small><p id="home-timer" class="home-timer number" hidden></p>','Timers','hero')+
    (config.showWeather ? card('Weather',dataPanel('weather'),'Weather','home-weather') : '')+
    card('University',agendaSummary(),'Agenda','home-summary')+
    (config.showTransport ? card('Departures',dataPanel('transport'),'Transport','home-summary') : '')+
    (config.showNba ? card('Next NBA game',dataPanel('nba'),'NBA','home-summary') : '')+
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
  const item = agenda.find(entry => entry.id === editing);
  return title('University agenda','Assessments are stored in this browser.')+
    '<form data-form="agenda"><div class="fields"><label>Subject<input name="subject" required maxlength="70" value="'+esc(item?.subject)+
    '"></label><label>Assessment<input name="title" required maxlength="100" value="'+esc(item?.title)+
    '"></label><label>Due in '+esc(config.zone)+'<input name="due" required type="datetime-local" value="'+
    (item ? zoneInput(item.due, config.zone) : '')+'"></label></div><p class="status" role="status"></p>'+
    '<div class="row"><button>'+(item ? 'Save assessment' : 'Add assessment')+'</button>'+
    (item ? button('Cancel','cancel-edit') : '')+'</div></form>'+
    [...agenda].sort((a,b) => Number(a.done)-Number(b.done) || a.due-b.due).map(entry =>
      '<article class="row between"><div><h2>'+esc(entry.title)+'</h2><small>'+esc(entry.subject)+
      ' · '+stamp(entry.due)+(entry.done ? ' · Completed' : '')+'</small></div><div class="row">'+
      button(entry.done ? 'Reopen' : 'Complete','complete',entry.id)+button('Edit','edit',entry.id)+
      button('Remove','remove',entry.id)+'</div></article>').join('');
}

function settings() {
  const input = (key,label,attrs='') => '<label>'+label+'<input name="'+key+'" value="'+esc(config[key])+'" '+attrs+'></label>';
  const select = (key,label,options) => '<label>'+label+'<select name="'+key+'">'+
    options.map(value => '<option'+(config[key]===value ? ' selected' : '')+'>'+value+'</option>').join('')+'</select></label>';
  const check = (key,label) => '<label class="row"><input name="'+key+'" type="checkbox"'+
    (config[key] ? ' checked' : '')+'>'+label+'</label>';
  const group = (id, heading, description, content, layout='settings-fields') =>
    '<section class="settings-group" aria-labelledby="settings-'+id+'"><h2 id="settings-'+id+'">'+heading+
    '</h2><p class="muted">'+description+'</p><div class="'+layout+'">'+content+'</div></section>';
  const modes = ['default','demo','live'];
  const refreshLabels = {weather:'Weather',transport:'Home departures',departures:'Transport detail',nba:'NBA'};
  const refreshFields = Object.entries(limits).map(([key,[min,max]]) =>
    input(key,refreshLabels[key]+' (seconds)','required type="number" min="'+min+'" max="'+max+'"')).join('');

  return '<div class="settings-page">'+title('Settings','Make Pharos fit your desk.')+
    '<form class="settings-form" data-form="settings"><div class="settings-save">'+
    '<p class="status" role="status">Changes save automatically.</p></div><div class="settings-grid">'+
    group('display','Display','Set the clock and colour theme.',
      input('zone','IANA timezone','required')+select('theme','Theme',['dark','light']))+
    group('home','Home cards','Choose which summaries appear on the dashboard.',
      check('showWeather','Weather on Home')+check('showTransport','Departures on Home')+
      check('showNba','NBA on Home'),'settings-checks')+
    group('preferences','Locations & team','Choose your weather location, rail route and favourite team.',
      input('location','Weather location','required maxlength="80"')+input('origin','Origin','required maxlength="80"')+
      input('destination','Destination (optional)','maxlength="80"')+
      input('team','NBA team code (optional)','maxlength="3" pattern="[A-Za-z]{3}"'))+
    group('providers','Data providers','Choose a default or override it for an individual feed.',
      select('mode','Default provider mode',['demo','live'])+select('weatherMode','Weather provider',modes)+
      select('transportMode','Train provider',modes)+select('nbaMode','NBA provider',modes))+
    group('refresh','Refresh intervals','Set how often visible cards check for updates.',refreshFields)+
    group('demo','Demo clock','Use a fixed date and time to preview sample data.',
      input('demo_clock','Demo data clock (UTC, optional)','type="datetime-local"'))+
    '</div></form><section class="settings-reference" aria-labelledby="settings-reference">'+
    '<h2 id="settings-reference">Sources & diagnostics</h2>'+
    '<details><summary>Developer diagnostics</summary><pre id="diagnostics">Open to load counts.</pre>'+
    button('Reload counts','diagnostics')+'</details>'+
    '<details><summary>Data sources</summary><p>Weather forecast from <a href="https://open-meteo.com/">Open-Meteo</a>.</p>'+
    '<p>Rail departures adapted from <a href="https://translink.com.au/about-translink/open-data">Translink open data</a> under '+
    '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.</p>'+
    '<p>NBA schedules and results from <a href="https://docs.balldontlie.io/">BALLDONTLIE</a>.</p></details></section></div>';
}

function drawData() {
  for (const req of active) {
    const panel = screen.querySelector('[data-dataset="'+req.kind+'"]');
    if (!panel) continue;
    const record = coordinator.record(req);
    const busy = coordinator.pending.has(req.key);
    const payload = record?.payload;
    const now = Date.now()/1000;
    const due = Math.max(record?.retry_at ?? 0, coordinator.retry.get(req.key) ?? 0);
    const isDemo = new URLSearchParams(req.key.split('?')[1]).get('mode') === 'demo';
    const demoNow = isDemo && config.demo_clock && record?.fetched_at
      ? record.source_at + now - record.fetched_at : now;
    let content = '<p class="muted">'+(busy ? 'Loading…' : record?.error || 'No data yet')+'</p>';
    if (payload && req.kind === 'weather') {
      content = '<p class="big">'+payload.temp+'°C</p><p>'+esc(payload.condition)+'</p><small>'+
        esc(payload.location)+' · H '+payload.high+'° · L '+payload.low+'° · Rain '+(payload.rain == null ? 'unavailable' : payload.rain+'%')+'</small>';
    }
    if (payload && req.kind === 'transport') {
      const upcoming = payload.filter(train => train.at > demoNow).slice(0,page === 'Home' ? 2 : 20);
      content = '<p>'+esc(config.origin)+(config.destination ? ' → '+esc(config.destination) : ' · All destinations')+'</p>'+
        (upcoming.map(train => '<div class="data-line"><strong>'+Math.ceil((train.at-demoNow)/60)+
          ' min</strong> · '+timeText(train.at*1000)+(train.platform ? ' · Platform '+esc(train.platform) : '')+
          '<small>'+(train.prediction ? (train.prediction_at && now-train.prediction_at > 120 ? 'Outdated prediction' : 'Prediction') : 'Scheduled')+(train.headsign ? ' · '+esc(train.headsign) : '')+'</small></div>').join('') ||
          '<p class="muted">No upcoming departures</p>');
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
      const line = (game, showDay = false) => '<div class="data-line"><strong>'+esc(game.away)+' @ '+esc(game.home)+
        '</strong><small>'+(showDay ? (dayKey(game.at*1000) === today ? 'Today · ' : 'Tomorrow · ') : '')+
        timeText(game.at*1000)+(game.score ? ' · Final '+esc(game.score) : '')+'</small></div>';
      if (page === 'Home') {
        const upcoming = games.filter(game => !game.score && game.at > demoNow);
        const next = upcoming.find(game => matches(game,config.team));
        const okc = upcoming.find(game => matches(game,'OKC'));
        content = (next ? line(next,true) : '<p class="muted">No upcoming games today or tomorrow</p>')+
          '<div class="nba-okc"><h3>Next OKC game</h3>'+
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
            (game.score ? 'Final '+esc(game.score) : timeText(game.at*1000))+'</span></li>').join('');
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
    const status = [isDemo ? 'Demo data' : ({weather:'Open-Meteo',transport:'Translink',nba:'BALLDONTLIE'})[req.kind]];
    if (record?.fetched_at != null) {
      status.push('Updated '+Math.max(0,Math.floor((now-record.fetched_at)/60))+' min ago');
      const expiry = req.kind === 'transport' ? 120 : req.age;
      if (now-record.fetched_at >= expiry) status.push('Outdated');
    }
    if (record?.error) status.push(record.error);
    if (busy) status.push('Refreshing…');
    else if (due > now) status.push('Refresh available in '+Math.ceil(due-now)+'s');
    const body = panel.querySelector('.data-content');
    if (body.dataset.rendered !== content) {
      body.innerHTML = content;
      body.dataset.rendered = content;
    }
    panel.querySelector('.data-status').textContent = status.join(' · ');
    const refresh = panel.querySelector('button');
    if (refresh) refresh.disabled = busy || due > now || record?.status === 'unavailable';
  }
}

function tick() {
  const now = Date.now();
  document.querySelector('#date').textContent = format(now,{weekday:'long',day:'numeric',month:'long'});
  const clock = document.querySelector('#clock');
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
  document.querySelector('#mode').textContent = ['weatherMode','transportMode','nbaMode'].some(key => config[key] !== 'default' && config[key] !== config.mode) ? 'MIXED SOURCES' : config.mode === 'demo' ? 'DEMO DATA' : 'LIVE MODE';
}

function show(target) {
  page = screens.includes(target) || target === 'Weather' ? target : 'Home';
  active = requirements(page,config);
  applyAppearance();
  nav.innerHTML = screens.map(name => button(name === 'Timers' ? 'Clock' : name,'go',name)).join('');
  nav.querySelector('[data-value="'+(page === 'Weather' ? 'Home' : page)+'"]').setAttribute('aria-current','page');
  const views = {Home:home,Timers:timerView,Agenda:agendaView,Settings:settings};
  screen.innerHTML = views[page] ? views[page]() : (page === 'NBA' ? '<h1>NBA</h1>' : title(page))+
    (page === 'NBA' ? '<section class="nba-panel">'+dataPanel('nba')+'</section>' :
      '<article>'+dataPanel(active[0].kind)+'</article>');
  for (const req of active) {
    screen.querySelector('[data-dataset="'+req.kind+'"]').innerHTML =
      '<div class="data-content"></div><small class="data-status"></small>'+(page === 'Home' ? '' : button('Refresh','refresh',req.kind));
  }
  drawData();
  tick();
  coordinator.subscribe('screen',active);
}

async function diagnostics() {
  const element = document.querySelector('#diagnostics');
  if (!element) return;
  try {
    const response = await fetch('/api/diagnostics',{signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error();
    element.textContent = JSON.stringify(await response.json(),null,2);
  } catch { element.textContent = 'Local server unreachable'; }
}

document.addEventListener('click',event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const {action,value} = control.dataset;
  if (action === 'go') {
    editing = undefined;
    if (value === 'Timers' && page === 'Timers') { clockTools = false; show(page); }
    else location.hash = value;
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
  if (action === 'diagnostics') return diagnostics();
  if (action === 'refresh') return coordinator.refresh(active.find(req => req.kind === value),true);
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
  const entry = agenda.find(item => item.id === value);
  if (action === 'edit') editing = value;
  if (action === 'cancel-edit') editing = undefined;
  if (entry && action === 'complete') entry.done = !entry.done;
  if (entry && action === 'remove') {
    agenda.splice(agenda.indexOf(entry),1);
    if (editing === value) editing = undefined;
  }
  if (entry) persistAgenda();
  show(page);
  if (action === 'edit') screen.querySelector('[name="subject"]').focus();
});

document.addEventListener('submit',event => {
  const form = event.target;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const status = form.querySelector('[role="status"]');
  if (form.dataset.form === 'agenda') {
    const due = fromZone(fields.due,config.zone);
    if (!Number.isFinite(due) || !fields.subject.trim() || !fields.title.trim()) {
      status.textContent = 'Enter a subject, title and valid local due time.';
      return;
    }
    const entry = agenda.find(item => item.id === editing);
    const values = {subject:fields.subject.trim(),title:fields.title.trim(),due};
    if (entry) Object.assign(entry,values);
    else agenda.push({id:crypto.randomUUID(),done:false,...values});
    editing = undefined;
    persistAgenda();
  }
  if (form.dataset.form !== 'settings') show(page);
});

screen.addEventListener('change',event => {
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
  if (Object.hasOwn(limits,key)) value = Number(value);
  if (key === 'team') value = value.toUpperCase();
  const next = {...config,[key]:value};
  try { save('settings',next); }
  catch { status.textContent = 'Settings could not be saved in this browser.'; return; }
  Object.assign(config,next);
  if (field.type === 'text') field.value = value;
  applyAppearance();
  status.textContent = 'Settings saved.';
});

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
screen.addEventListener('toggle',event => { if (event.target.open && event.target.querySelector('#diagnostics')) diagnostics(); },true);
window.addEventListener('hashchange',() => { editing = undefined; clockTools = false; show(location.hash.slice(1)); });
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