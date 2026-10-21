import test from 'node:test';
import assert from 'node:assert/strict';
import messages from '../public/translations-delivery-preview.js';
import {translate} from '../public/i18n.js';

test('result preview and completion actions have loaded French English Dutch labels',()=>{
  for(const[source,targets]of Object.entries(messages)){
    assert.equal(translate(source,'fr'),source);
    for(const locale of['en','nl']){
      assert.equal(typeof targets[locale],'string',`${locale}: ${source}`);
      assert.ok(targets[locale].trim());assert.notEqual(targets[locale],source);
      assert.equal(translate(source,locale),targets[locale]);
      if(source.endsWith(' ↗'))assert.ok(targets[locale].endsWith(' ↗'));
    }
  }
  const personal='Ma mission personnelle : Une pizza pour Ingrid';
  for(const locale of['fr','en','nl'])assert.equal(translate(personal,locale),personal);
  for(const locale of['en','nl']){
    for(const source of Object.keys(messages).filter(item=>item.includes('index.html')))assert.ok(translate(source,locale).includes('index.html'));
    const limits=translate('Aperçu limité à 200 fichiers, 15 Mo par fichier et 50 Mo au total.',locale);
    for(const amount of['200','15','50'])assert.ok(limits.includes(amount));
  }
});
