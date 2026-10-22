// Short scene messages must leave the room visible again. Important messages
// are explicitly persistent; model text never decides its own priority.
export class OfficeNotice {
  constructor({element,content,label,closeButton,onDismiss=()=>{},duration=8000,clock=globalThis}={}){
    Object.assign(this,{element,content,label,closeButton,onDismiss,clock});
    this.duration=Math.max(1000,Math.min(30000,Number(duration)||8000));
    this.now=()=>clock.performance?.now?.()??clock.Date?.now?.()??Date.now();
    this.timer=null;this.current=null;this.paused=new Set();this.context=null;this.destroyed=false;
    this.enter=()=>this.pause('pointer');this.leave=()=>this.resume('pointer');
    this.focus=()=>this.pause('focus');
    this.blur=event=>{if(!element?.contains?.(event.relatedTarget))this.resume('focus');};
    this.close=()=>this.dismiss({manual:true});
    element?.addEventListener('pointerenter',this.enter);element?.addEventListener('pointerleave',this.leave);
    element?.addEventListener('focusin',this.focus);element?.addEventListener('focusout',this.blur);
    closeButton?.addEventListener('click',this.close);
    if(element)element.hidden=true;
  }
  clearTimer(){if(this.timer!==null){this.clock.clearTimeout(this.timer);this.timer=null;}}
  schedule(){
    this.clearTimer();const item=this.current;
    if(this.destroyed||!item||item.dismissed||item.persistent||this.paused.size)return;
    if(item.remaining<=0){this.dismiss();return;}
    item.started=this.now();
    this.timer=this.clock.setTimeout(()=>{this.timer=null;if(this.current===item&&!this.destroyed)this.dismiss();},item.remaining);
  }
  show({id,text,label='',persistent=false}={}){
    if(this.destroyed||typeof text!=='string'||!text.trim())return false;
    const key=String(id??text);
    // State/voice refreshes must neither prolong nor reopen an old message.
    if(this.current?.key===key)return false;
    if(this.current?.persistent&&!this.current.dismissed&&persistent!==true)return false;
    this.clearTimer();
    this.current={key,persistent:persistent===true,dismissed:false,remaining:this.duration,started:this.now()};
    this.content.textContent=text;if(this.label)this.label.textContent=String(label);
    this.element.hidden=false;this.schedule();return true;
  }
  pause(reason){
    if(this.destroyed||this.paused.has(reason))return;
    if(this.timer!==null&&this.current){this.current.remaining=Math.max(0,this.current.remaining-(this.now()-this.current.started));this.clearTimer();}
    this.paused.add(reason);
  }
  resume(reason){if(this.destroyed||!this.paused.delete(reason))return;this.schedule();}
  hold(value){if(value)this.pause('audio');else this.resume('audio');}
  dismiss({manual=false}={}){
    if(this.destroyed)return;this.clearTimer();this.paused.clear();
    if(this.current)this.current.dismissed=true;
    if(this.element)this.element.hidden=true;
    if(manual)this.onDismiss();
  }
  setContext(value){if(value===this.context)return;this.context=value;this.reset();}
  reset(){this.clearTimer();this.current=null;this.paused.clear();if(this.element)this.element.hidden=true;}
  destroy(){
    if(this.destroyed)return;this.reset();this.destroyed=true;
    this.element?.removeEventListener('pointerenter',this.enter);this.element?.removeEventListener('pointerleave',this.leave);
    this.element?.removeEventListener('focusin',this.focus);this.element?.removeEventListener('focusout',this.blur);
    this.closeButton?.removeEventListener('click',this.close);
  }
}
