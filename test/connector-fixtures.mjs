import {INHERITED_APPS,parseInheritedApps as parseAppMetadata} from '../lib/connector-clients.mjs';

export function runtimeTools(snapshot){
  return (snapshot.details?.apps||[]).flatMap(app=>(app.toolSummaries||[]).map(tool=>({
    name:app.id===INHERITED_APPS.gmail.id?`gmail.${tool.name}`:app.id===INHERITED_APPS.calendar.id?`google_calendar.${tool.name}`:tool.name,
    title:tool.name,_meta:{connector_id:app.id},annotations:{readOnlyHint:tool.isReadOnly===true,destructiveHint:tool.isReadOnly!==true},
  })));
}
export const runtimeStatus=snapshot=>({data:[{name:'codex_apps',tools:Object.fromEntries(runtimeTools(snapshot).map((tool,index)=>[String(index),tool])),toolsError:null}],nextCursor:null});
export const parseInheritedApps=snapshot=>parseAppMetadata({...snapshot,runtimeTools:snapshot.runtimeTools??runtimeTools(snapshot)});
