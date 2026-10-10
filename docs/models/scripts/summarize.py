"""What each model run cost and how its calls went, from the files run-model.sh writes.

From the repository root:
  python -I docs/models/scripts/summarize.py .rampa/model-runs/run1-gemma4-12b ... > docs/models/runs.json

Scores are not repeated here: they are in each run's summary.json and results.jsonl (`rampa compare` reads those).
"""
import json
import re
import statistics
import sys
from pathlib import Path

# nvidia-smi's memory.used with no model loaded on the GPU the runs used (an RTX 5060 Ti driving a desktop).
IDLE_GPU_MIB = 1310


def read_meta(work):
    meta = {}
    for line in (work / 'meta.txt').read_text(encoding='utf-8').splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            meta[key] = value
    return meta


def run_dir(work):
    out = (work / 'stdout.txt').read_text(encoding='utf-8', errors='replace')
    match = re.search(r'Results: (\S+)', out)
    return Path(match.group(1).replace('\\', '/')) if match else None


def vram(work, model):
    best = {'apiPsSizeVramGiB': 0.0, 'contextLength': None, 'gpuUsedOverIdleMaxGiB': None, 'otherModelsLoaded': set()}
    used_max = 0
    for line in (work / 'vram.tsv').read_text(encoding='utf-8').splitlines():
        parts = line.split('\t')
        if len(parts) < 3:
            continue
        try:
            loaded = json.loads(parts[1]).get('models', [])
        except json.JSONDecodeError:
            loaded = []
        for m in loaded:
            if m['name'] == model:
                best['apiPsSizeVramGiB'] = max(best['apiPsSizeVramGiB'], round(m.get('size_vram', 0) / 2**30, 2))
                best['contextLength'] = m.get('context_length')
            else:
                best['otherModelsLoaded'].add(m['name'])
        try:
            used_max = max(used_max, int(parts[2].split(',')[0]))
        except (ValueError, IndexError):
            pass
    best['otherModelsLoaded'] = sorted(best['otherModelsLoaded'])
    best['gpuUsedOverIdleMaxGiB'] = round((used_max - IDLE_GPU_MIB) / 1024, 2) if used_max else None
    return best


def summarize(work):
    meta = read_meta(work)
    model = meta['model']
    rd = run_dir(work)
    records = [json.loads(line) for line in (rd / 'results.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    log = [json.loads(line) for line in (work / 'calls.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    log = [c for c in log if c['url'].endswith('/chat/completions')]
    ok = [c for c in log if c.get('status') == 200]
    ms = sorted(c['ms'] for c in ok)
    usable = sum(r['usage']['calls'] for r in records)
    return {
        'run': rd.name,
        'model': f'ollama:{model}',
        'commit': meta['commit'],
        'start': meta['start'],
        'end': meta['end'],
        'wallSeconds': int(meta['end_epoch']) - int(meta['start_epoch']),
        'calls': {
            'http': len(log),
            'http200': len(ok),
            # Every candidate sent to the model is one HTTP call; the AI SDK retries only a failed HTTP call.
            'usableAnswers': usable,
            'answersNotJson': sum(1 for c in ok if not c.get('json')),
            'answersRejected': len(ok) - usable,
            'finishLength': sum(1 for c in ok if c.get('finish') == 'length'),
            'httpErrors': [{'status': c['status'], 'body': c.get('body') or c.get('error')} for c in log if 'status' in c and c['status'] != 200],
            'thrown': [c['threw'] for c in log if 'threw' in c],
            'notJsonSamples': [{'finish': c.get('finish'), 'content': (c.get('content') or '')[:300]} for c in ok if not c.get('json')],
            'withImages': sum(1 for c in log if (c.get('request') or {}).get('images')),
            'withImagesOk': sum(1 for c in ok if (c.get('request') or {}).get('images')),
            'reasoningEffortSent': sorted({str((c.get('request') or {}).get('reasoning_effort')) for c in log}),
            'temperatureSent': sorted({str((c.get('request') or {}).get('temperature')) for c in log}),
            'reasoningCharsReturned': sum(c.get('reasoningChars') or 0 for c in ok),
            'secondsMedian': round(statistics.median(ms) / 1000, 1) if ms else None,
            'secondsP90': round(statistics.quantiles(ms, n=10)[-1] / 1000, 1) if len(ms) >= 10 else None,
            'secondsMax': round(ms[-1] / 1000, 1) if ms else None,
            'promptTokens': sum((c.get('usage') or {}).get('prompt_tokens', 0) for c in ok),
            'completionTokens': sum((c.get('usage') or {}).get('completion_tokens', 0) for c in ok),
        },
        'pagesWithModelError': [
            {'criterion': r['criterion'], 'ruleId': r['ruleId'], 'testcaseId': r['testcaseId'], 'error': r['modelError'][:200]}
            for r in records
            if not r.get('error') and r.get('modelError')
        ],
        'pagesNotLoaded': sum(1 for r in records if r.get('error')),
        'vram': vram(work, model),
    }


print(json.dumps([summarize(Path(arg)) for arg in sys.argv[1:]], indent=2, ensure_ascii=False))
