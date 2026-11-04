"""Offline guards and one current-rule behavior check for the holds lab."""
import json
import hashlib
import itertools
import os
import re
import shutil
import subprocess
import sys
import unittest
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from policy import categorize, flag_holds, simulate
sys.path.insert(0,str(HERE.parent/'recorder'))
import common

class PolicyGuards(unittest.TestCase):
    def setUp(self):
        self.take={'id':'t','title':'Test','route':'human','structural_failure':False,'unobserved_flags':0,
                   'flags':[{'id':'f','kind':'swap','written':'found','heard':'felt','category':'real-looking substitution','advisory':False,'second_agrees':None}]}
    def test_unknown_second_opinion_cannot_release(self):
        self.assertEqual(simulate([self.take],{'certainty':'second'})['takes'][0]['status'],'unknown')
    def test_structural_checks_keep_their_route_specific_outcome(self):
        self.take['structural_failure']=True
        self.assertEqual(simulate([self.take],{'action':'publish'})['takes'][0]['status'],'review')
        self.assertEqual(simulate([self.take],{'action':'fail'})['takes'][0]['status'],'review')
        self.take['route']='generated'
        self.assertEqual(simulate([self.take],{'action':'publish'})['takes'][0]['status'],'failed')
    def test_unobserved_flags_not_silently_released(self):
        self.take['flags']=[];self.take['unobserved_flags']=2
        self.assertEqual(simulate([self.take],{'problem':'meaning'})['takes'][0]['status'],'unknown')
        row=simulate([self.take])['takes'][0]
        self.assertEqual((row['status'],row['count_only_trigger_flags']),('review',2))
    def test_labels_count_only_person_marked_errors(self):
        r=simulate([self.take],labels={'f':'voice_wrong'})
        self.assertEqual((r['caught'],r['missed'],r['unresolved']),(1,0,0))
        r=simulate([self.take],{'certainty':'second'},labels={'f':'voice_wrong'})
        self.assertEqual((r['caught'],r['missed'],r['unresolved']),(0,0,1))
    def test_a_hold_blocks_every_labeled_error_in_the_take(self):
        other=dict(self.take['flags'][0],id='g',category='word ending',written='days',heard='day')
        self.take['flags'].append(other)
        r=simulate([self.take],{'problem':'meaning'},labels={'g':'voice_wrong'})
        self.assertEqual((r['caught'],r['missed']),(1,0))
    def test_second_listener_disagreement_does_not_hold(self):
        self.take['flags'][0]['second_agrees']=False
        self.assertIs(flag_holds(self.take['flags'][0],{'certainty':'second'}),False)
        self.assertEqual(simulate([self.take],{'certainty':'second'})['takes'][0]['status'],'published')
    def test_homograph_wrong_sound_same_spelling_invisible_to_reconcile(self):
        # Two possible pronunciations of "read" produce the same spelled token input.
        _,report=common.reconcile([('read',0.1,0.4)],[],['read'],names=[])
        self.assertEqual(report['flag_count'],0)
        self.assertEqual(report['flags'],[])
        _,changed=common.reconcile([('red',0.1,0.4)],[],['read'],names=[])
        self.assertGreater(changed['flag_count'],0)
    def test_publish_with_flags_misses_labeled_error(self):
        r=simulate([self.take],{'action':'publish'},labels={'f':'voice_wrong'})
        self.assertEqual((r['caught'],r['missed']),(0,1))
    def test_desktop_report_is_not_an_aws_gate_result(self):
        self.take['source']='aligned-1031'
        self.assertEqual(simulate([self.take])['takes'][0]['status'],'unknown')
    def test_homograph_watch_holds_a_matching_clean_take(self):
        self.take['flags']=[];self.take['homograph_words']={'read':1}
        self.assertEqual(simulate([self.take],{'certainty':'homograph'})['takes'][0]['status'],'review')
    def test_word_ending_requires_a_real_suffix(self):
        self.assertEqual(categorize('swap','bed','bee'),'real-looking substitution')
        self.assertEqual(categorize('swap','played','play'),'word ending')
        self.assertEqual(categorize('swap','days','day'),'word ending')
    def test_human_gate_flags_have_local_audio_and_honest_spots(self):
        private=HERE/'private'/'sample.json'
        if not private.is_file(): self.skipTest('private historical sample is absent')
        data=json.loads(private.read_text(encoding='utf-8'))
        rows=[(t,f) for t in data['takes'] if t['source']=='gatefix-1101' and t['route']=='human' for f in t['flags']]
        self.assertEqual(len(rows),19)
        for take,flag in rows:
            self.assertTrue(take['audio'],flag['id'])
            self.assertTrue(flag['at'] is not None or flag.get('candidate_times'),flag['id'])
            self.assertTrue(flag.get('time_basis'),flag['id'])
            if flag.get('candidate_times'):
                self.assertEqual(len(flag['candidate_times']),len(flag['candidate_contexts']))
    def test_audio_server_serves_only_sample_recordings_and_ranges(self):
        import serve
        private=HERE/'private'/'sample.json'
        if not private.is_file(): self.skipTest('private sample and audio are absent')
        data=json.loads(private.read_text(encoding='utf-8'))
        entry=next((t for t in data['takes'] if t.get('audio')),None)
        if entry is None: self.skipTest('private sample has no audio')
        source=entry['audio'].split('/')[2]
        folder=os.environ.get('SOUND_ALONG_HOLDS_AUDIO_1031' if source=='aligned-1031' else 'SOUND_ALONG_HOLDS_AUDIO_1103')
        if not folder: self.skipTest('set the matching SOUND_ALONG_HOLDS_AUDIO_1031 or SOUND_ALONG_HOLDS_AUDIO_1103 path')
        old_root,old_sources=serve.ROOT,dict(serve.SOURCES)
        serve.ROOT=HERE/'private'/'build'
        subprocess.run([sys.executable,str(HERE/'build_pages.py'),'--private'],check=True)
        serve.SOURCES[source]=Path(folder)
        audio_path=serve.SOURCES[source]/(entry['audio'].split('/')[-1])
        if not audio_path.is_file():
            serve.ROOT,serve.SOURCES=old_root,old_sources
            self.skipTest('configured local audio file is absent')
        server=ThreadingHTTPServer(('127.0.0.1',0),serve.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base=f'http://127.0.0.1:{server.server_port}'
            with urlopen(base+'/label.html') as response:
                self.assertEqual(response.status,200)
                self.assertIn(b'Listen or read, then label',response.read())
            with urlopen(Request(base+entry['audio'],headers={'Range':'bytes=0-15'})) as response:
                self.assertEqual((response.status,len(response.read())),(206,16))
                self.assertTrue(response.headers['Content-Range'].startswith('bytes 0-15/'))
            with self.assertRaises(Exception): urlopen(base+'/audio/aligned-1031/00000000-0000-0000-0000-000000000000.mp3')
        finally:
            server.shutdown();server.server_close();thread.join()
            serve.ROOT,serve.SOURCES=old_root,old_sources
    def test_sample_ids_unique_and_not_labeled(self):
        data=json.loads((HERE/'sample.json').read_text(encoding='utf-8'))
        flags=[f['id'] for t in data['takes'] for f in t['flags']]
        self.assertEqual(len(flags),len(set(flags)))
        self.assertFalse(any('label' in f for t in data['takes'] for f in t['flags']))
        digest=hashlib.sha256(json.dumps(data['takes'],ensure_ascii=False,sort_keys=True).encode('utf-8')).hexdigest()
        self.assertEqual(data['sample_id'],digest)
    @unittest.skipUnless(shutil.which('node'),'Node needed for offline-page parity')
    def test_page_and_python_model_agree(self):
        data=json.loads((HERE/'sample.json').read_text(encoding='utf-8'))
        structural={'id':'structural','title':'Structural check','source':'synthetic-test',
                    'flags':[],'unobserved_flags':0,'homograph_words':{},'structural_failure':True}
        takes=data['takes']+[dict(structural,route='human'),dict(structural,route='generated')]
        choices=[{'problem':p,'certainty':c,'action':a} for p,c,a in
                 itertools.product(('all','meaning','body'),('one','second','homograph'),('hold','publish','fail'))]
        script="""const fs=require('fs'),vm=require('vm'),path=require('path');
const root=process.argv[1], DATA=JSON.parse(fs.readFileSync(path.join(root,'sample.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'index.js'),'utf8').split('const box=')[0];
const context={DATA};vm.createContext(context);vm.runInContext(source,context);
const choices=JSON.parse(process.argv[2]);
const structural={id:'structural',title:'Structural check',source:'synthetic-test',flags:[],unobserved_flags:0,homograph_words:{},structural_failure:true};
const takes=DATA.takes.concat([{...structural,route:'human'},{...structural,route:'generated'}]);
process.stdout.write(JSON.stringify(choices.map(c=>context.holdsLabModel(takes,c).map(r=>r.status))));"""
        result=subprocess.run(['node','-e',script,str(HERE),json.dumps(choices)],capture_output=True,text=True,check=True)
        page=json.loads(result.stdout)
        python=[[r['status'] for r in simulate(takes,c)['takes']] for c in choices]
        self.assertEqual(page,python)
    @unittest.skipUnless(shutil.which('node'),'Node needed for offline-page smoke')
    def test_page_renders_and_unknown_scale_is_not_zero(self):
        script="""const fs=require('fs'),vm=require('vm'),path=require('path');
const root=process.argv[1],DATA=JSON.parse(fs.readFileSync(path.join(root,'sample.json'),'utf8'));
const elements={},document={getElementById(id){return elements[id]??=(
  {innerHTML:'',textContent:'',addEventListener(type,fn){this.onchange=fn}})}};
const context={DATA,document};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'index.js'),'utf8'),context);
const baseline=elements.scale.textContent,baselineRisk=elements.catastrophe.textContent;
elements.choices.onchange({target:{name:'problem',value:'meaning'}});
const excusedRisk=elements.catastrophe.textContent;
elements.choices.onchange({target:{name:'certainty',value:'second'}});
const second=elements.scale.textContent,secondRisk=elements.catastrophe.textContent;
const choiceNotes=elements.choiceEstimates.innerHTML;
elements.choices.onchange({target:{name:'certainty',value:'homograph'}});
process.stdout.write(JSON.stringify({baseline,second,flow:elements.flow.innerHTML,baselineRisk,excusedRisk,secondRisk,choiceNotes,watchScale:elements.scale.textContent}));"""
        result=subprocess.run(['node','-e',script,str(HERE)],capture_output=True,text=True,check=True)
        view=json.loads(result.stdout)
        self.assertIn('sample has',view['baseline'])
        self.assertIn('No library or staffing estimate',view['second'])
        self.assertIn('Human recording:',view['flow'])
        self.assertIn("Can't tell",view['baselineRisk'])
        self.assertGreater(int(re.search(r'(\d+) observed differences are excused',view['excusedRisk']).group(1)),0)
        self.assertIn('unknown outcomes',view['secondRisk'])
        self.assertIn('second-listener answer',view['choiceNotes'])
        self.assertIn('sample has',view['watchScale'])
    @unittest.skipUnless(shutil.which('node'),'Node needed for offline-label smoke')
    def test_label_page_embedded_script_renders_offline(self):
        script="""const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(process.argv[1],'label.html'),'utf8');
let source=html.match(/<script>([\\s\\S]*?)<\\/script>/)[1];
const demo=JSON.parse(fs.readFileSync(path.join(process.argv[1],'sample.json'),'utf8'));
demo.takes[0].audio='/audio/aligned-1031/11111111-1111-1111-1111-111111111111.mp3';
demo.takes[0].flags[0].at=2.4;
source=source.replace(/const DATA=.*?;/,'const DATA='+JSON.stringify(demo)+';');
const make=()=>({textContent:'',value:'',children:[],readyState:1,pause(){},play(){this.playCount=(this.playCount||0)+1;return Promise.resolve()},load(){},getAttribute(){return null},replaceChildren(){this.children=[]},append(x){this.children.push(x)}});
const elements={},radio=['voice_wrong','recognizer_wrong','doesnt_matter','unsure'].map(value=>({value,checked:false}));
const document={getElementById(id){return elements[id]??=make()},querySelectorAll(){return radio},createElement(){return make()}};
vm.runInNewContext(source,{document});
const first={position:elements.position.textContent,title:elements.title.textContent,audioButtons:elements.audioBox.children.filter(x=>x.children.some(y=>y.onclick)).length};
elements.audioBox.children.find(x=>x.children.some(y=>y.onclick)).children.find(x=>x.onclick).onclick();
first.oneTapPlays=elements.player.playCount;
elements.player.readyState=0;
elements.audioBox.children.find(x=>x.children.some(y=>y.onclick)).children.find(x=>x.onclick).onclick();
first.playsBeforeMetadata=elements.player.playCount;
elements.player.onloadedmetadata();
first.playsAfterMetadata=elements.player.playCount;
elements.next.onclick();
process.stdout.write(JSON.stringify({first,after:elements.position.textContent,noMatch:elements.audioBox.textContent}));"""
        result=subprocess.run(['node','-e',script,str(HERE)],capture_output=True,text=True,check=True)
        view=json.loads(result.stdout)
        self.assertIn('of 2',view['first']['position'])
        self.assertIn('Made-up example',view['first']['position'])
        self.assertGreater(view['first']['audioButtons'],0)
        self.assertEqual(view['first']['oneTapPlays'],1)
        self.assertEqual((view['first']['playsBeforeMetadata'],view['first']['playsAfterMetadata']),(1,2))
        self.assertIn('Made-up example',view['after'])
        self.assertIn('No matching local audio',view['noMatch'])

def current_rule_behavior():
    data=json.loads((HERE/'sample.json').read_text(encoding='utf-8'))
    rows={r['id']:r['status'] for r in simulate(data['takes'])['takes']}
    expected={'demo:1':'review','demo:2':'review','demo:3':'published','demo:4':'failed'}
    same=all(rows.get(k)==v for k,v in expected.items())
    print('BEHAVIOR (current, pencil): '+('pass' if same else 'changed')+' — made-up baseline statuses')
    return same


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(PolicyGuards)
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    same=current_rule_behavior()
    print(f'SUMMARY guards_passed={result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped)} guards_failed={len(result.failures)+len(result.errors)} behavior_matching={int(same)} behavior_changed={int(not same)} skipped={len(result.skipped)}')
    sys.exit(not result.wasSuccessful())
