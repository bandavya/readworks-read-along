# Generative voice setting

*What changes when the generative voice is enabled?*

Making the audio · Status: built, off by default

Some listeners may enjoy a more expressive voice. The optional generative setting uses one, named Ruth. That voice does not return the word start times Sound Along normally relies on. So the pipeline records the audio first, then runs speech recognition (software that turns speech into text) to find where each word falls. It lines the recognized words up with the written passage and builds a timing file of the usual shape.

Recognition can mishear a word. If too few recognized words match the written text, the run stops instead of publishing timing it cannot trust. When a written word is missing from the recognition, its time is estimated between its neighbors. A run that succeeds therefore does not prove every highlight is exact. The separate heard-versus-written check can also be switched on to hold suspected word changes before publication.

**Ruth changes both the sound and where word times come from, so recognition-based timing needs a person to listen.**

Word times come last, after the audio exists:

```mermaid
flowchart LR
  A["Written passage"] -->|speech text| B["Ruth audio"]
  B -->|MP3| C["Speech recognition"]
  C -->|recognized words| D["Align to written words"]
  D -->|word times| E["Validation and reader"]
```

## How it connects

[Word timing](word-timing.md) explains the estimated marks the other path uses. [Heard versus written check](heard-versus-written-check.md) describes the extra hold, and [Cost of a passage](cost-of-a-passage.md) shows how billing differs.

## Where it stands

This path is off by default and has run only in automated tests with stand-in AWS services. The stack's cloud template generates locally, but no current Ruth run on the event AWS account was confirmed. Ruth's earlier favorable feedback came from a separate test account and an earlier pipeline; it does not validate this timing path or the current reader. No target-device trial with sound and a reader was confirmed.

---

## Technical details

`-c generativeVoice=true` is read as the string `true` in `lib/sound-along-stack.ts`; it requires `en-US` and overrides voice and engine to Ruth/generative. `lambdas/generative_voice/handler.py` submits only an MP3 task, starts a Transcribe batch job after Polly completes, polls every ten seconds, reads its JSON, and creates one word mark per written alphanumeric token with UTF-8 byte offsets. Equal token sequences align; capitalized words and numerals can count as aligned in same-length replacements. Unmatched written words get interpolated times. Below 80% aligned spoken tokens, missing transcript, or failed recognition marks the job failed. The workflow timeout grows to 30 minutes.

With `qualityGate=true`, `lib/quality-gate.ts` reuses that transcript and still checks the heard words; without it, alignment alone decides whether timing can proceed. The reader source becomes `Polly generative, timed by Amazon Transcribe`. Test locally with `python tests/test_generative_voice.py` and `npx cdk synth -c generativeVoice=true`; the first uses fake services and the second only checks the template.

---

Previous: [Narration voice](narration-voice.md) · [Spec home](README.md) · Next: [Word timing](word-timing.md)
