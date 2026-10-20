import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCalendarIntent,validateCalendarEvent,CALENDAR_EVENT_LIMITS} from '../lib/calendar-intent.mjs';

const now=Date.parse('2026-10-20T08:00:00Z'),options={now,timeZone:'Europe/Brussels'};
const input=(extra={})=>({title:'Réunion équipe',startLocal:'2026-10-21T16:00',endLocal:'2026-10-21T17:00',timeZone:'Europe/Brussels',durationSource:'default',...extra});
const payload=draft=>Object.fromEntries(['title','startLocal','endLocal','timeZone','durationSource','location','description'].filter(key=>draft[key]!==undefined).map(key=>[key,draft[key]]));

test('French, English and Dutch requests resolve tomorrow without inventing a title or using a model',()=>{
  for(const prompt of ['Ajoute un rendez-vous chez le dentiste demain à 16h pendant 30 minutes','Add dentist to my calendar tomorrow at 4pm for 30 minutes','Plan tandarts morgen om 16 uur gedurende 30 minuten']){
    const draft=parseCalendarIntent(prompt,options);assert.equal(draft.startLocal,'2026-10-21T16:00');assert.equal(draft.endLocal,'2026-10-21T16:30');assert.equal(draft.durationMinutes,30);assert.equal(draft.durationSource,'explicit');assert.equal(draft.needsConfirmation,true);assert.deepEqual(draft.missing,[]);assert.deepEqual(draft.issues,[]);
    const event=validateCalendarEvent(payload(draft),options);assert.equal(event.start,'2026-10-21T16:00:00+02:00');assert.equal(event.startUtc,'2026-10-21T14:00:00.000Z');assert.equal(event.timezoneOffset,'+02:00');assert.equal(event.endTimezoneOffset,'+02:00');assert.equal(event.needsConfirmation,true);assert(Object.isFrozen(event));assert(!('attendees'in event));
  }
});

test('next Wednesday is an absolute future date, including when today is Wednesday',()=>{
  for(const prompt of ['Planifie « Réunion équipe » mercredi prochain à 16h','Schedule "Team meeting" next Wednesday at 16:00','Plan "Teamoverleg" volgende woensdag om 16 uur']){
    const draft=parseCalendarIntent(prompt,options);assert.equal(draft.startLocal,'2026-10-21T16:00');assert.equal(draft.durationSource,'default');assert.equal(draft.endLocal,'2026-10-21T17:00');assert.deepEqual(draft.missing,[]);
  }
  const next=parseCalendarIntent('Dentiste mercredi à 16h',{...options,now:Date.parse('2026-10-21T08:00:00Z')});assert.equal(next.startLocal,'2026-10-28T16:00');
});

test('calendar-day arithmetic uses the selected timezone rather than UTC or a fixed 24-hour day',()=>{
  const nearMidnight={...options,now:Date.parse('2026-10-20T22:30:00Z')};assert.equal(parseCalendarIntent('Dentiste demain à 16h',nearMidnight).startLocal,'2026-10-22T16:00');
  const spring={...options,now:Date.parse('2026-03-28T23:30:00Z')};assert.equal(parseCalendarIntent('Dentiste demain à 16h',spring).startLocal,'2026-03-30T16:00');
});

test('simple absolute dates, explicit end times and chosen default durations remain visible',()=>{
  const explicit=parseCalendarIntent('Réunion 21/10/2026 de 16h à 17h30',options);assert.equal(explicit.title,'Réunion');assert.equal(explicit.startLocal,'2026-10-21T16:00');assert.equal(explicit.endLocal,'2026-10-21T17:30');assert.equal(explicit.durationSource,'explicit');assert.equal(explicit.durationMinutes,90);
  const chosen=parseCalendarIntent('Dentiste 2026-10-21 à 16:30',{...options,defaultDurationMinutes:45});assert.equal(chosen.endLocal,'2026-10-21T17:15');assert.equal(chosen.durationSource,'default');
  assert.equal(parseCalendarIntent('Dentiste mercredi à 16h pendant 1h30',options).durationMinutes,90);
});

test('missing and conflicting information is returned for the editable form, never invented',()=>{
  assert.deepEqual(parseCalendarIntent('Demain à 16h',options).missing,['title']);
  assert.deepEqual(parseCalendarIntent('Ajoute un rendez-vous demain',options).missing,['title','time']);
  assert.deepEqual(parseCalendarIntent('Réunion à 16h',options).missing,['date']);
  const conflict=parseCalendarIntent('Réunion demain et vendredi à 16h',options);assert(conflict.missing.includes('date'));assert.equal(conflict.startLocal,'');assert(conflict.issues.some(value=>value.includes('Plusieurs dates')));
  const title=parseCalendarIntent('Planifie « Demain » mercredi à 16h',options);assert.equal(title.title,'Demain');assert.equal(title.startLocal,'2026-10-21T16:00');assert.deepEqual(title.issues,[]);
});

test('Brussels nonexistent and repeated DST wall times are rejected instead of silently shifted',()=>{
  for(const [startLocal,endLocal,reference,reason] of [['2026-03-29T02:30','2026-03-29T03:30','2026-03-28T08:00:00Z','DST_GAP'],['2026-10-25T02:30','2026-10-25T03:30','2026-10-24T08:00:00Z','DST_AMBIGUOUS']]){
    assert.throws(()=>validateCalendarEvent(input({startLocal,endLocal}),{...options,now:Date.parse(reference)}),error=>error.code==='CALENDAR_INVALID'&&error.field==='startLocal'&&error.reason===reason);
  }
  const draft=parseCalendarIntent('Dentiste demain à 02h30',{...options,now:Date.parse('2026-03-28T08:00:00Z')});assert(draft.issues.some(value=>value.includes('changement d’heure')));assert.equal(draft.endLocal,'');
});

test('an event crossing spring DST has validated offsets and real elapsed duration',()=>{
  const event=validateCalendarEvent(input({startLocal:'2026-03-29T01:30',endLocal:'2026-03-29T03:30',durationSource:'explicit'}),{...options,now:Date.parse('2026-03-28T08:00:00Z')});
  assert.equal(event.durationMinutes,60);assert.equal(event.timezoneOffset,'+01:00');assert.equal(event.endTimezoneOffset,'+02:00');assert.equal(event.startUtc,'2026-03-29T00:30:00.000Z');assert.equal(event.endUtc,'2026-03-29T01:30:00.000Z');
  const autumn=validateCalendarEvent(input({startLocal:'2026-10-25T01:30',endLocal:'2026-10-25T03:30',durationSource:'explicit'}),{...options,now:Date.parse('2026-10-24T08:00:00Z')});assert.equal(autumn.durationMinutes,180);assert.equal(autumn.timezoneOffset,'+02:00');assert.equal(autumn.endTimezoneOffset,'+01:00');
});

test('validation rejects invitations, extra permissions, invalid dates and unmarked or excessive durations',()=>{
  for(const extra of [{attendees:['other@example.com']},{calendarId:'external'},{confirmed:true},{tool:'delete_event'},{rrule:'FREQ=DAILY'},{startLocal:'2026-02-30T16:00'},{startLocal:'2026-10-21T24:00'},{timeZone:'Europe/NotAZone'},{durationSource:undefined},{endLocal:'2026-10-21T15:00'},{endLocal:'2026-10-21T16:04'},{endLocal:'2026-10-23T16:00'},{title:''},{title:'x'.repeat(CALENDAR_EVENT_LIMITS.title+1)},{location:'bad\nplace'}])assert.throws(()=>validateCalendarEvent(input(extra),options),{code:'CALENDAR_INVALID'});
  assert.throws(()=>validateCalendarEvent(input({startLocal:'2026-10-19T16:00',endLocal:'2026-10-19T17:00'}),options),error=>error.reason==='PAST');
  const event=validateCalendarEvent(input({location:' Bruxelles ',description:'Documents à préparer.\nAucun invité.',durationSource:'explicit'}),options);assert.equal(event.location,'Bruxelles');assert.equal(event.description,'Documents à préparer.\nAucun invité.');assert.equal(event.durationSource,'explicit');
});

test('quarter-hour timezone offsets are validated rather than rounded to a whole hour',()=>{
  const event=validateCalendarEvent(input({timeZone:'Asia/Kathmandu'}),options);assert.equal(event.timezoneOffset,'+05:45');assert.equal(event.startUtc,'2026-10-21T10:15:00.000Z');
});
