/** Browsing a folder never starts a mission. Only the latest choice can select it. */
export class DeliveryNavigation {
  constructor({load,onSelect=()=>{},onChange=()=>{}}){Object.assign(this,{load,onSelect,onChange});this.state={mode:'library',id:null,detail:null,error:null};this.revision=0;}
  change(state){this.state=state;this.onChange(state);}
  cancelPending(){this.revision++;this.controller?.abort();this.controller=null;if(this.state.mode==='loading')this.change({...this.state,mode:'library',error:null});}
  library(){this.revision++;this.controller?.abort();this.controller=null;this.change({...this.state,mode:'library',error:null});}
  show(detail){this.revision++;this.controller?.abort();this.controller=null;this.change({mode:'detail',id:detail.id,detail,error:null});}
  async open(id){
    if(this.destroyed||typeof id!=='string'||!/^[a-z\d-]{1,100}$/iu.test(id))return;
    this.controller?.abort();const controller=new AbortController(),revision=++this.revision;this.controller=controller;
    this.change({mode:'loading',id,detail:null,error:null});
    try{
      const detail=await this.load(id,{signal:controller.signal});
      if(this.destroyed||controller.signal.aborted||revision!==this.revision)return;
      if(!detail||detail.id!==id)throw new Error('Ce dossier n’a pas pu être ouvert. Réessayez.');
      this.state={mode:'detail',id,detail,error:null};this.onSelect(detail);this.onChange(this.state);return detail;
    }catch(error){if(!this.destroyed&&!controller.signal.aborted&&revision===this.revision)this.change({mode:'error',id,detail:null,error:error.message||'Ce dossier n’a pas pu être ouvert. Réessayez.'});}
    finally{if(this.controller===controller)this.controller=null;}
  }
  destroy(){this.destroyed=true;this.revision++;this.controller?.abort();this.controller=null;}
}
