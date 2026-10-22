import {getLocale} from './i18n.js';
import {officeText} from './translations-office.js';

const node=(tag,cls,text)=>{const item=document.createElement(tag);if(cls)item.className=cls;if(text!==undefined)item.textContent=text;return item;};
const safeColor=value=>typeof value==='string'&&/^[a-f\d]{6}$/iu.test(value)?'#'+value:null;
export function officeColumnName(number){if(!Number.isInteger(number)||number<1||number>40)return'';let result='';for(let n=number;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
/** Text nodes and a few bounded style values only; never HTML, URLs or formulas. */
export class OfficeViewer{
  constructor({container}={}){this.container=container;this.destroyed=false;this.current=null;this.sheetIndex=0;this.showFormulas=true;this.elements=[];}
  label(key){return officeText(key,getLocale());}
  open(data){
    if(this.destroyed)return;
    if(!data||!['word','spreadsheet'].includes(data.kind)||!['ready','partial'].includes(data.status)||!Array.isArray(data.warnings)||data.warnings.length>12||data.kind==='word'&&(!Array.isArray(data.blocks)||data.blocks.length>1000)||data.kind==='spreadsheet'&&(!Array.isArray(data.sheets)||data.sheets.length>20))throw new Error(this.label('Le lecteur n’a pas confirmé le contenu de ce document.'));
    this.current=data;this.sheetIndex=data.kind==='spreadsheet'?Math.max(0,data.sheets.findIndex(sheet=>sheet.state==='visible')):0;this.elements=[];this.formulaText=null;this.gridHost=null;this.empty=null;this.root=node('section','office-viewer');this.root.setAttribute('aria-label',this.label('Lecture du document'));this.root.setAttribute('data-no-translate','');
    this.notice=node('p','office-viewer-notice');this.warningList=node('ul','office-viewer-warnings');for(const warning of data.warnings)this.warningList.append(node('li','',this.label(String(warning).slice(0,1000))));this.warningList.hidden=!data.warnings.length;
    this.root.append(this.notice,this.warningList);
    if(data.kind==='word')this.buildWord();else this.buildWorkbook();this.updateLabels();this.container.replaceChildren(this.root);return this;
  }
  buildWord(){
    this.page=node('article','office-word-page');this.page.tabIndex=0;
    for(const block of this.current.blocks){
      if(block?.kind==='paragraph'){
        const paragraph=node(Number.isInteger(block.heading)&&block.heading>=1&&block.heading<=6?'h'+block.heading:'p','office-word-paragraph');
        paragraph.style.textAlign=['left','right','center','justify'].includes(block.alignment)?block.alignment:'left';
        if(['header','footer'].includes(block.section))paragraph.classList.add('office-word-'+block.section);
        for(const run of (Array.isArray(block.runs)?block.runs:[]).slice(0,10000)){
          const span=node('span','',typeof run?.text==='string'?run.text.slice(0,4000):'');if(run.bold===true)span.style.fontWeight='700';if(run.italic===true)span.style.fontStyle='italic';if(run.underline===true)span.style.textDecoration='underline';const color=safeColor(run.color);if(color)span.style.color=color;if(Number.isFinite(run.size)&&run.size>=8&&run.size<=40)span.style.fontSize=run.size+'pt';paragraph.append(span);
        }
        this.page.append(paragraph);
      }else if(block?.kind==='table'&&Array.isArray(block.rows)){
        const table=node('table','office-word-table'),body=node('tbody');for(const row of block.rows.slice(0,200)){const tr=node('tr');for(const value of (Array.isArray(row)?row:[]).slice(0,40))tr.append(node('td','',typeof value==='string'?value.slice(0,4000):''));body.append(tr);}table.append(body);this.page.append(table);
      }
    }
    if(!this.page.children.length){this.empty=node('p','office-viewer-empty');this.page.append(this.empty);}this.root.append(this.page);
  }
  buildWorkbook(){
    this.toolbar=node('div','office-workbook-toolbar');this.tabs=node('div','office-workbook-tabs');this.tabs.setAttribute('role','tablist');this.tabButtons=[];
    this.current.sheets.forEach((sheet,index)=>{const button=node('button','office-workbook-tab',String(sheet.name||'').slice(0,31));button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(index===this.sheetIndex));button.addEventListener('click',()=>this.setSheet(index));this.tabButtons.push(button);this.tabs.append(button);});
    this.formulaLabel=node('label','office-workbook-formulas');this.formulaCheck=node('input');this.formulaCheck.type='checkbox';this.formulaCheck.checked=this.showFormulas;this.formulaCheck.addEventListener('change',()=>{this.showFormulas=this.formulaCheck.checked;this.renderSheet();});this.formulaText=node('span');this.formulaLabel.append(this.formulaCheck,this.formulaText);this.sheetMeta=node('p','office-workbook-meta');this.toolbar.append(this.tabs,this.formulaLabel,this.sheetMeta);
    this.gridHost=node('div','office-workbook-scroll');this.gridHost.tabIndex=0;this.gridHost.setAttribute('role','region');this.root.append(this.toolbar,this.gridHost);this.renderSheet();
  }
  setSheet(index){if(this.destroyed||!Number.isInteger(index)||index<0||index>=this.current.sheets.length)return;this.sheetIndex=index;for(const[at,button]of this.tabButtons.entries())button.setAttribute('aria-selected',String(at===index));this.renderSheet();}
  renderSheet(){
    this.empty=null;const sheet=this.current.sheets[this.sheetIndex];if(!sheet){this.empty=node('p','office-viewer-empty');this.gridHost.replaceChildren(this.empty);this.updateLabels();return;}
    const totalRows=Number.isInteger(sheet.totalRows)?sheet.totalRows:0,totalColumns=Number.isInteger(sheet.totalColumns)?sheet.totalColumns:0,columns=Math.min(Math.max(totalColumns,1),40),rows=Array.isArray(sheet.rows)?sheet.rows.slice(0,200):[],last=Math.min(200,rows.at(-1)?.number||0),mapping=new Map(rows.filter(row=>Number.isInteger(row?.number)&&row.number>0&&row.number<=200).map(row=>[row.number,row]));
    const table=node('table','office-workbook-grid'),head=node('thead'),headRow=node('tr');headRow.append(node('th','office-workbook-corner',''));for(let column=1;column<=columns;column++){const th=node('th','',officeColumnName(column));th.scope='col';headRow.append(th);}head.append(headRow);table.append(head);const body=node('tbody');
    for(let number=1;number<=last;number++){const tr=node('tr'),heading=node('th','',String(number));heading.scope='row';tr.append(heading);const values=new Map((Array.isArray(mapping.get(number)?.cells)?mapping.get(number).cells:[]).filter(cell=>Number.isInteger(cell?.column)&&cell.column>=1&&cell.column<=40).map(cell=>[cell.column,cell]));for(let column=1;column<=columns;column++){
      const cell=values.get(column),td=node('td');if(cell){const formula=cell.formula===true,missingCache=formula&&!this.showFormulas&&typeof cell.cachedValue!=='string',value=formula&&!this.showFormulas?(missingCache?'—':cell.cachedValue):cell.text;td.textContent=typeof value==='string'?value.slice(0,4000):'';if(formula){td.classList.add('is-formula');td.title=(missingCache?this.label('Aucune valeur calculée enregistrée dans le fichier.'):this.label('Formule non calculée'))+' : '+String(cell.text||'').slice(0,4000);}if(typeof cell.numberFormat==='string')td.setAttribute('data-number-format',cell.numberFormat.slice(0,120));if(cell.bold===true)td.style.fontWeight='700';if(cell.italic===true)td.style.fontStyle='italic';const color=safeColor(cell.color),background=safeColor(cell.background);if(color)td.style.color=color;if(background)td.style.backgroundColor=background;}tr.append(td);
    }body.append(tr);}table.append(body);this.gridHost.replaceChildren(table);if(!last){this.empty=node('p','office-viewer-empty');this.gridHost.append(this.empty);}this.sheetMeta.textContent=[String(sheet.name||'').slice(0,31),this.label('$1 lignes · $2 colonnes').replace('$1',String(totalRows)).replace('$2',String(totalColumns)),sheet.state!=='visible'?this.label('Feuille masquée dans le fichier original'):null].filter(Boolean).join(' · ');this.updateLabels();
  }
  updateLabels(){if(!this.current||this.destroyed)return;this.notice.textContent=this.label(this.current.kind==='word'?'Word · lecture simplifiée, sans modification du fichier original':'Excel · lecture seule, aucun calcul ni connexion externe');if(this.formulaText)this.formulaText.textContent=this.label('Afficher les formules');if(this.empty)this.empty.textContent=this.label('Aucun contenu affichable dans cette partie du document.');this.gridHost?.setAttribute('aria-label',this.label('Cellules de la feuille'));if(this.current.kind==='spreadsheet'){const sheet=this.current.sheets[this.sheetIndex];if(sheet)this.sheetMeta.textContent=[String(sheet.name||'').slice(0,31),this.label('$1 lignes · $2 colonnes').replace('$1',String(sheet.totalRows||0)).replace('$2',String(sheet.totalColumns||0)),sheet.state!=='visible'?this.label('Feuille masquée dans le fichier original'):null].filter(Boolean).join(' · ');}if(this.warningList){const nodes=[...this.warningList.children];this.current.warnings.forEach((warning,index)=>{if(nodes[index])nodes[index].textContent=this.label(String(warning).slice(0,1000));});}}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.current=null;this.root?.remove();this.tabButtons=[];}
}
