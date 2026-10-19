import {getLocale, translate} from './i18n.js';

const LOCALES = {fr:'fr-BE', en:'en-GB', nl:'nl-BE'};
const QUIPS = [
  'La deadline est à l’heure. Moi aussi, à un café près.',
  'Une seconde pour regarder l’heure, puis une belle idée.',
  'Les aiguilles avancent. L’équipe aussi.',
  'Le temps passe. Les bonnes idées restent.',
];
let clockNumber = 0;

export class ClockDialog {
  constructor({onClose=()=>{}, host=globalThis}={}) {
    if(!host.document?.body) throw new Error('La page doit être prête pour ouvrir l’horloge.');
    this.host=host;this.document=host.document;this.onClose=onClose;
    this.timer=null;this.opened=false;this.destroyed=false;this.quipIndex=0;this.lastTime='';this.lastDate='';
    this.build();
    this._onClose=()=>{if(!this.dialog.open)this.finishedClosing();};
    this._onCancel=event=>{event.preventDefault();this.close();};
    this._onBackdrop=event=>{
      if(event.target!==this.dialog)return;
      const rect=this.dialog.getBoundingClientRect();
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.close();
    };
    this._onVisibility=()=>{if(this.opened){this.stopTimer();this.tick();if(!this.document.hidden)this.startTimer();}};
    this._onLanguage=()=>{if(this.opened){this.lastTime='';this.lastDate='';this.tick();}};
    this.dialog.addEventListener('close',this._onClose);
    this.dialog.addEventListener('cancel',this._onCancel);
    this.dialog.addEventListener('click',this._onBackdrop);
    this.document.addEventListener('visibilitychange',this._onVisibility);
    this.document.addEventListener('oscar:language',this._onLanguage);
  }

  element(tag, className, text) {
    const element=this.document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=text;
    return element;
  }

  build() {
    const id=++clockNumber;
    const dialog=this.element('dialog','clock-dialog');
    dialog.setAttribute('aria-labelledby',`clock-title-${id}`);
    dialog.setAttribute('aria-describedby',`clock-note-${id}`);
    dialog.setAttribute('aria-modal','true');
    this.dialog=dialog;
    const header=this.element('header','clock-dialog-header');
    const heading=this.element('div','clock-heading');
    heading.append(this.element('span','clock-eyebrow','LE TEMPS AU BUREAU'));
    const title=this.element('h2','clock-title','L’horloge d’Oscar');title.id=`clock-title-${id}`;heading.append(title);
    const close=this.element('button','clock-close','×');close.type='button';close.setAttribute('aria-label','Fermer l’horloge');close.addEventListener('click',()=>this.close());this.closeButton=close;
    header.append(heading,close);

    const face=this.element('div','clock-face');
    face.append(this.buildDial());
    const digital=this.element('div','clock-digital');
    this.time=this.element('time','clock-time');this.time.setAttribute('data-no-translate','');
    this.hours=this.element('span','clock-hours');this.seconds=this.element('span','clock-seconds');this.seconds.setAttribute('aria-hidden','true');
    this.time.append(this.hours,this.seconds);digital.append(this.time);
    this.date=this.element('p','clock-date');this.date.setAttribute('data-no-translate','');digital.append(this.date);
    const live=this.element('span','clock-live');
    const dot=this.element('i','clock-live-dot');dot.setAttribute('aria-hidden','true');
    live.append(dot,this.element('span','','Heure locale · en direct'));digital.append(live);

    const oscar=this.element('section','clock-oscar');
    const avatar=this.element('span','clock-oscar-avatar');avatar.setAttribute('aria-hidden','true');
    avatar.append(this.element('i','clock-oscar-hair'),this.element('i','clock-oscar-eyes'),this.element('i','clock-oscar-smile'));
    const thought=this.element('div','clock-thought');thought.append(this.element('strong','clock-oscar-name','Oscar'));
    this.quip=this.element('p','clock-quip',QUIPS[0]);thought.append(this.quip);
    const another=this.element('button','clock-another','Une autre pensée d’Oscar ↻');another.type='button';another.addEventListener('click',()=>{this.quipIndex=(this.quipIndex+1)%QUIPS.length;this.quip.textContent=QUIPS[this.quipIndex];});
    thought.append(another);oscar.append(avatar,thought);

    const footer=this.element('footer','clock-footer');
    const note=this.element('p','clock-note','L’heure de votre ordinateur. Les missions continuent pendant cette pause.');note.id=`clock-note-${id}`;
    const back=this.element('button','clock-back','Retour au bureau');back.type='button';back.addEventListener('click',()=>this.close());
    footer.append(note,back);
    dialog.append(header,face,digital,oscar,footer);this.document.body.append(dialog);
  }

  buildDial() {
    const namespace='http://www.w3.org/2000/svg';
    const create=(tag,attributes={},parent)=>{
      const node=this.document.createElementNS(namespace,tag);
      for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));
      parent?.append(node);return node;
    };
    const svg=create('svg',{viewBox:'0 0 300 300','aria-hidden':'true',focusable:'false',class:'clock-dial'});
    create('circle',{cx:150,cy:152,r:141,fill:'#cbd7ca',opacity:.34},svg);
    create('circle',{cx:150,cy:146,r:139,fill:'#f5eee0',stroke:'#ded8c6','stroke-width':2},svg);
    create('circle',{cx:150,cy:146,r:128,fill:'#fffdf6',stroke:'#ebe5d7','stroke-width':1},svg);
    const center=146;
    for(let index=0;index<60;index++) {
      const angle=index*Math.PI/30-Math.PI/2,major=index%5===0;
      const outer=118,inner=major?109:114;
      create('line',{x1:150+Math.cos(angle)*inner,y1:center+Math.sin(angle)*inner,x2:150+Math.cos(angle)*outer,y2:center+Math.sin(angle)*outer,stroke:major?'#7e9483':'#d6ded1','stroke-width':major?2.7:1.2,'stroke-linecap':'round'},svg);
    }
    for(const hour of [12,3,6,9]) {
      const angle=hour*Math.PI/6-Math.PI/2;
      const label=create('text',{x:150+Math.cos(angle)*91,y:center+Math.sin(angle)*91+6,'text-anchor':'middle',fill:'#7a8a77','font-size':19,'font-family':'system-ui, sans-serif','font-weight':550},svg);
      label.textContent=String(hour);
    }
    const brand=create('text',{x:150,y:103,'text-anchor':'middle',fill:'#b2b6a1','font-size':10,'letter-spacing':2,'font-family':'system-ui, sans-serif'},svg);brand.textContent='OSCAR';
    create('path',{d:'M137 182 Q150 192 163 182',fill:'none',stroke:'#d5af9a','stroke-width':2.5,'stroke-linecap':'round'},svg);
    create('circle',{cx:138,cy:173,r:2,fill:'#b7bdad'},svg);create('circle',{cx:162,cy:173,r:2,fill:'#b7bdad'},svg);
    this.hourHand=create('line',{x1:150,y1:center+9,x2:150,y2:center-56,stroke:'#526f5f','stroke-width':7,'stroke-linecap':'round',class:'clock-hour-hand'},svg);
    this.minuteHand=create('line',{x1:150,y1:center+13,x2:150,y2:center-84,stroke:'#789482','stroke-width':4.6,'stroke-linecap':'round',class:'clock-minute-hand'},svg);
    this.secondHand=create('line',{x1:150,y1:center+22,x2:150,y2:center-99,stroke:'#d29680','stroke-width':1.8,'stroke-linecap':'round',class:'clock-second-hand'},svg);
    create('circle',{cx:150,cy:center,r:6,fill:'#526f5f'},svg);create('circle',{cx:150,cy:center,r:2.5,fill:'#f7e6ca'},svg);
    return svg;
  }

  tick() {
    if(this.destroyed||!this.opened)return;
    const now=new Date(),locale=LOCALES[getLocale()]||LOCALES.fr;
    const time=now.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const seconds=String(now.getSeconds()).padStart(2,'0');
    if(this.lastTime!==`${time}:${seconds}`) {
      this.hours.textContent=time;this.seconds.textContent=seconds;
      this.time.dateTime=now.toISOString();
      this.time.setAttribute('aria-label',`${translate('Heure locale')} : ${time}:${seconds}`);
      this.lastTime=`${time}:${seconds}`;
    }
    const date=now.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    if(this.lastDate!==date){this.date.textContent=date;this.lastDate=date;}
    const s=now.getSeconds(),m=now.getMinutes(),h=now.getHours()%12;
    this.secondHand.setAttribute('transform',`rotate(${s*6} 150 146)`);
    this.minuteHand.setAttribute('transform',`rotate(${m*6+s/10} 150 146)`);
    this.hourHand.setAttribute('transform',`rotate(${h*30+m/2+s/120} 150 146)`);
  }

  startTimer() {
    if(this.timer!==null||!this.opened||this.document.hidden)return;
    this.timer=this.host.setInterval(()=>this.tick(),1000);
  }
  stopTimer() {if(this.timer!==null){this.host.clearInterval(this.timer);this.timer=null;}}

  open() {
    if(this.destroyed)return this;
    if(this.opened){this.closeButton.focus();return this;}
    this.previousFocus=this.document.activeElement;this.opened=true;this.lastTime='';this.lastDate='';
    this.quipIndex=0;this.quip.textContent=QUIPS[0];this.tick();
    try{this.dialog.showModal();}catch(error){this.opened=false;throw error;}
    this.startTimer();this.closeButton.focus();return this;
  }
  finishedClosing() {
    this.stopTimer();
    if(!this.opened)return;
    this.opened=false;
    if(this.previousFocus?.isConnected&&typeof this.previousFocus.focus==='function')this.previousFocus.focus({preventScroll:true});
    this.onClose();
  }
  close() {this.stopTimer();if(this.dialog.open)this.dialog.close();this.finishedClosing();return this;}
  destroy() {
    if(this.destroyed)return;
    this.close();this.destroyed=true;
    this.dialog.removeEventListener('close',this._onClose);this.dialog.removeEventListener('cancel',this._onCancel);this.dialog.removeEventListener('click',this._onBackdrop);
    this.document.removeEventListener('visibilitychange',this._onVisibility);this.document.removeEventListener('oscar:language',this._onLanguage);
    this.dialog.remove();this.onClose=()=>{};
  }
}
