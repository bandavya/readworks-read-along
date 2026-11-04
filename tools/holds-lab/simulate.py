"""Run the offline simulation and an optional human-label audit. No AWS."""
import argparse
import json
from pathlib import Path
from policy import simulate

HERE=Path(__file__).resolve().parent


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sample',type=Path,default=HERE/'sample.json',help='sample JSON; private/sample.json is ignored by git')
    p.add_argument('--labels',type=Path,help='JSON exported by label.html')
    p.add_argument('--problem',choices=['all','meaning','body'],default='all')
    p.add_argument('--certainty',choices=['one','second','homograph'],default='one')
    p.add_argument('--action',choices=['hold','publish','fail'],default='hold')
    p.add_argument('--play',choices=['old','human','none'],default='old')
    p.add_argument('--owner',choices=['editor','producer','narrator'],default='editor')
    p.add_argument('--stick',choices=['scoped','name','global'],default='scoped')
    p.add_argument('--json',action='store_true')
    args=p.parse_args()
    data=json.loads(args.sample.read_text(encoding='utf-8'))
    labels={}
    if args.labels:
        obj=json.loads(args.labels.read_text(encoding='utf-8'))
        if (obj.get('schema')!=2 or obj.get('sample_id')!=data['sample_id']
                or not isinstance(obj.get('labels'),dict)):
            p.error('labels JSON is not for this exact sample; re-export after rebuilding')
        valid_ids={f['id'] for t in data['takes'] for f in t['flags']}
        if set(obj['labels'])-valid_ids: p.error('labels JSON contains unknown flag IDs')
        if not isinstance(obj.get('reviewer'),str) or not obj['reviewer'].strip():
            p.error('labels JSON needs a reviewer name')
        if any(not isinstance(v,dict) for v in obj['labels'].values()): p.error('invalid label record')
        labels={k:v.get('answer') for k,v in obj['labels'].items()}
        if any(v not in ('voice_wrong','recognizer_wrong','doesnt_matter','unsure') for v in labels.values()): p.error('invalid label answer')
    choices={'problem':args.problem,'certainty':args.certainty,'action':args.action,
             'play':args.play,'owner':args.owner,'stick':args.stick}
    out=simulate(data['takes'],choices,labels)
    gatefix=[r for r in out['takes'] if r['id'].startswith('gatefix:')]
    historical_mismatch=[{'id':r['id'],'recorded':r['recorded'],'modeled':r['status']} for r in gatefix if r['recorded']!=r['status']]
    summary={'choices':choices,'counts':out['counts'],
             'person_labels_used':out['labels_used'],'reviewer':obj['reviewer'] if args.labels else None,
             'labeled_voice_errors_blocked':out['caught'],
             'labeled_voice_errors_exposed':out['missed'],'labeled_voice_errors_unresolved':out['unresolved'],
             'recorded_status_difference':historical_mismatch,
             'independent_replay_unavailable':data['replay_mismatches'],
             'note':'Model output for the loaded sample; no audio judgment is implied.'}
    if args.json:
        summary['takes']=out['takes']
        print(json.dumps(summary,ensure_ascii=False,indent=2))
    else:
        print('Modeled:',summary['counts'])
        print('Person labels:',out['labels_used'],'| labeled voice errors blocked:',out['caught'],
              'exposed:',out['missed'],'unknown:',out['unresolved'])
        print('Recorded-status differences under this policy:',len(historical_mismatch),'| cannot independently replay:',len(data['replay_mismatches']))
        for row in historical_mismatch: print('DIFFERENCE',row)
        for row in out['takes']:
            if row['status']=='review':
                print('HOLD',row['id'],'flags',','.join(row['hold_flags']) or '-',
                      'count-only',row['count_only_trigger_flags'],'watch',','.join(row['watch_words']) or '-')
        print(summary['note'])

if __name__=='__main__': main()
