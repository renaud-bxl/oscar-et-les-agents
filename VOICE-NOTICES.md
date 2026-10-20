# Préécoutes vocales incluses

Les douze fichiers `public/voice-preview-*.wav` sont des exemples de parole
synthétique générés avec Pocket TTS, en français, anglais et néerlandais. Ils
permettent d'écouter une voix avant d'installer son moteur local. Ils ne sont pas
des enregistrements de l'utilisateur et n'autorisent aucun clonage personnel.

Le code [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) est sous licence
[MIT](https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE). Les
[poids publics sans clonage de Kyutai](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)
sont sous [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| Fichiers de préécoute | Preset et provenance | Licence du matériau vocal |
| --- | --- | --- |
| `voice-preview-oscar-paul-v2-{fr,en,nl}.wav` | Paul, VCTK p259, CSTR / University of Edinburgh | CC BY 4.0 |
| `voice-preview-zoe-{fr,en,nl}.wav` | Estelle, enregistrement Kyutai `developpeuse-3` | CC0 |
| `voice-preview-oscar-2-{fr,en,nl}.wav` | Charles, VCTK p254, CSTR / University of Edinburgh | CC BY 4.0 |
| `voice-preview-zoe-vera-v2-{fr,en,nl}.wav` | Vera, VCTK p229, CSTR / University of Edinburgh | CC BY 4.0 |

Sources des presets : [Kyutai TTS voices](https://huggingface.co/kyutai/tts-voices).
Sources de Charles : [CSTR VCTK Corpus](https://datashare.ed.ac.uk/handle/10283/3443)
et [preset p254](https://huggingface.co/kyutai/tts-voices/blob/main/vctk/p254_023_enhanced.wav).
Source de Paul : [preset p259](https://huggingface.co/kyutai/tts-voices/blob/main/vctk/p259_023_enhanced.wav).
Source de Vera : [preset p229](https://huggingface.co/kyutai/tts-voices/blob/main/vctk/p229_023_enhanced.wav).
Attribution VCTK : Yamagishi, Junichi ; Veaux, Christophe ; MacDonald, Kirsten
(2019), *CSTR VCTK Corpus*, version 0.92, University of Edinburgh.

Paul et Vera remplacent respectivement les anciens choix Marius et Alba. Leurs
identifiants et fichiers de préécoute sont versionnés afin de ne pas réutiliser
un ancien son en cache. Charles et Estelle sont conservés. Les anciens fichiers
éventuellement présents dans les données locales ne sont pas effacés.
Paul, Vera et Charles ont des voix sources anglophones ; Estelle a une voix
source française. Les trois langues sont synthétisées par leurs modèles
respectifs, sans garantie d’accent natif ni de qualité identique selon la langue.
Les états préétablis sont téléchargés au commit
`4e1e0a3e611c51c0b4ed8174fc10f32a54644303` du dépôt officiel sans clonage.

Ces matériaux servent à une transformation par synthèse vocale. Les noms Oscar
et Zoé désignent les personnages de l'application ; ils n'impliquent pas un
parrainage par les fournisseurs ou les personnes créditées.
Les notices et empreintes des fichiers du moteur facultatif sont également
conservées dans `SOURCES-ET-LICENCES.txt` lors de son installation.
