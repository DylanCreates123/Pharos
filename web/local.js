import {read, save} from './config.js';

export const timers = read('timers', []);
export const agenda = read('agenda', []);
export function remaining(timer, now = Date.now()) {
  return Math.max(0, timer.deadline === null ? timer.left : timer.deadline - now);
}
export function updateTimer(timer, action, now = Date.now()) {
  if (action === 'start' && timer.deadline === null && timer.left > 0) timer.deadline = now + timer.left;
  if (action === 'pause') {
    timer.left = remaining(timer, now);
    timer.deadline = null;
  }
  if (action === 'reset') {
    timer.deadline = null;
    timer.left = timer.duration;
  }
}
export function persistTimers() { save('timers', timers); }
export function persistAgenda() { save('agenda', agenda); }

// Interpret the wall time in the configured IANA zone even when the browser uses another zone.
export function zoneInput(instant, zone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {timeZone:zone, year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const parts = Object.fromEntries(fmt.formatToParts(instant).map(({type,value}) => [type,value]));
  return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}
export function fromZone(input, zone) {
  const target = Date.parse(input+'Z');
  let guess = target;
  for (let i=0; i<3; i++) guess += target - Date.parse(zoneInput(guess,zone)+'Z');
  return zoneInput(guess,zone) === input ? guess : NaN;
}
