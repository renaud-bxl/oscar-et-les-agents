/** Decorative local-clock schedule, independent of location, weather and astronomical data. */
const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};

export function getAmbience(date) {
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new TypeError('Une date locale valide est nécessaire.');
  const hour=date.getHours()+date.getMinutes()/60+date.getSeconds()/3600+date.getMilliseconds()/3600000;
  const phase=hour<6||hour>=20?'night':hour<8?'dawn':hour<18?'day':'sunset';
  const daylight=hour<6||hour>=20?0:hour<8?smooth((hour-6)/2):hour<18?1:1-smooth((hour-18)/2);
  const progress=clamp((hour-6)/14),altitude=Math.sin(progress*Math.PI);
  const moonProgress=clamp((hour>=20?hour-20:hour+4)/10);
  const twilight=phase==='dawn'?(hour-6)/2:phase==='sunset'?(hour-18)/2:0;
  return {
    hour,phase,daylight,warmth:phase==='dawn'||phase==='sunset'?Math.sin(twilight*Math.PI):0,
    source:'local-clock',
    sun:{visible:hour>=6&&hour<20,progress,x:.08+progress*.84,y:.82-altitude*.64,altitude,opacity:hour>=6&&hour<20?Math.max(.18,daylight):0},
    moon:{visible:daylight<.55,x:.15+moonProgress*.7,y:.35-Math.sin(moonProgress*Math.PI)*.14,opacity:1-daylight},
    stars:1-daylight,lampsOn:daylight<.6,lampStrength:1-daylight
  };
}
