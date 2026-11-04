"""Offline hold-policy model. Suggestions only; pipeline never imports this module."""
from collections import Counter

HOMOGRAPHS = ('read', 'lead', 'wind', 'tear', 'bow', 'live', 'minute', 'wound', 'close', 'record')


def categorize(kind, written, heard, context='', advisory=False):
    """A descriptive grouping, not a claim about what was said in the audio."""
    w, h = written.strip().lower(), heard.strip().lower()
    if 'by readworks' in (w + ' ' + context.lower()) or 'byline' in context.lower(): return 'title and byline'
    if advisory or kind == 'accent': return 'spelling of the same word'
    if kind == 'missing' and not any(ch.isalnum() for ch in written): return 'punctuation or alignment artifact'
    if kind == 'extra': return 'extra speech'
    if kind == 'missing': return 'dropped words'
    if any(ch.isdigit() for ch in w + h): return 'numbers and dates'
    if w in {'a','an','the','of','to','in','on','and','or','is','was','were','it','his','her','by','for'}: return 'small function word'
    if ((w.endswith('s') and w.removesuffix('s') == h)
            or (h.endswith('s') and h.removesuffix('s') == w)
            or (w.endswith('ed') and w.removesuffix('ed') == h)
            or (h.endswith('ed') and h.removesuffix('ed') == w)): return 'word ending'
    return 'real-looking substitution'


def flag_holds(flag, choices):
    if flag.get('advisory'): return False
    category = flag['category']
    problem = choices.get('problem', 'all')
    if problem == 'meaning' and category in {'word ending','spelling of the same word','title and byline'}: return False
    if problem == 'body' and category == 'title and byline': return False
    certainty = choices.get('certainty', 'one')
    if certainty == 'second':
        if flag.get('second_agrees') is None: return None
        return flag['second_agrees'] is True
    return True


def simulate(takes, choices=None, labels=None):
    """Pure per-take simulation. Unknown evidence yields an explicit unknown, never a release.

    A label is keyed by stable flag ID and is one of voice_wrong, recognizer_wrong, doesnt_matter.
    Structural failures take precedence. 'review' is today's pipeline hold status.
    """
    choices, labels = choices or {}, labels or {}
    valid = {'problem': ({'all', 'meaning', 'body'}, 'all'),
             'certainty': ({'one', 'second', 'homograph'}, 'one'),
             'action': ({'hold', 'publish', 'fail'}, 'hold'),
             'play': ({'old', 'human', 'none'}, 'old'),
             'owner': ({'editor', 'producer', 'narrator'}, 'editor'),
             'stick': ({'scoped', 'name', 'global'}, 'scoped')}
    for key, (allowed, default) in valid.items():
        if choices.get(key, default) not in allowed:
            raise ValueError(f'Unknown {key} choice: {choices[key]}')
    results = []
    for take in takes:
        if take.get('source', '').startswith('aligned-'):
            status, pending = 'unknown', []
        elif take.get('structural_failure'):
            # The generated route fails; the human route holds for review.
            # These checks are not word flags, so the flag-action choice cannot override them.
            status, pending = ('review' if take['route'] == 'human' else 'failed'), []
        else:
            pending = [f for f in take['flags'] if flag_holds(f, choices) is True]
            uncertain = any(flag_holds(f, choices) is None for f in take['flags'])
            if take.get('unobserved_flags', 0) and choices.get('problem', 'all') != 'all': uncertain = True
            if take.get('unobserved_flags', 0) and choices.get('certainty', 'one') == 'second': uncertain = True
            watch = bool(take.get('homograph_words')) and choices.get('certainty') == 'homograph'
            status = 'review' if pending or watch else ('unknown' if uncertain else ('review' if take.get('unobserved_flags', 0) else 'published'))
        if not take.get('structural_failure'):
            if status == 'review' and choices.get('action', 'hold') == 'publish': status = 'published_with_flags'
            if status == 'review' and choices.get('action') == 'fail': status = 'failed'
        labeled_errors = sum(labels.get(f['id']) == 'voice_wrong' for f in take['flags'])
        # A held or failed take cannot expose any of its labeled errors, even if
        # a different flag triggered the hold. Unknown takes have no gate verdict.
        caught = labeled_errors if status in {'review', 'failed'} else 0
        missed = labeled_errors if status in {'published', 'published_with_flags'} else 0
        unresolved = labeled_errors if status == 'unknown' else 0
        results.append({'id': take['id'], 'title': take['title'], 'route': take['route'], 'status': status,
                        'hold_flags': [f['id'] for f in pending],
                        'count_only_trigger_flags': (take.get('unobserved_flags', 0)
                                                  if choices.get('problem', 'all') == 'all'
                                                  and choices.get('certainty', 'one') != 'second' else 0),
                        'unobserved_flag_count': take.get('unobserved_flags', 0),
                        'watch_words': list(take.get('homograph_words', {})) if choices.get('certainty') == 'homograph' else [], 'caught': caught, 'missed': missed, 'unresolved': unresolved,
                        'recorded': take.get('recorded'), 'evidence': take.get('evidence')})
    return {'counts': dict(Counter(r['status'] for r in results)), 'takes': results,
            'caught': sum(r['caught'] for r in results), 'missed': sum(r['missed'] for r in results),
            'unresolved': sum(r['unresolved'] for r in results),
            'labels_used': sum(labels.get(f['id']) in {'voice_wrong','recognizer_wrong','doesnt_matter'}
                               for t in takes for f in t['flags'])}
