# Polly cost planning note

This adds a small estimate for a fresh passage. Prices below are **unverified recollections supplied for this hackathon**. **Check current AWS pricing** for the chosen region, engine, voice, free tier, speech marks, and any service minimums before budgeting. The repository README uses about $4 per million characters for neural narration; this note keeps that number intact and flags the discrepancy with the recollected neural price of $16.

The sample `demo-passage-001.json` has 234 characters after whitespace normalization. The three demo passages together have 234 + 300 + 336 = 870 characters. The audio request estimate is `characters / 1,000,000 x price`. The workflow also submits a separate speech-mark request with the same text. If that request is billed at the same character rate, double the audio figures. This is a planning assumption; **check current AWS pricing** for speech-mark billing and engine support. S3, Step Functions, Lambda, CloudFront, DynamoDB, and data transfer are additional and not estimated here.

| Polly engine | Provisional price per million characters | One 234-character passage, audio request | Three-passage 870-character catalog, audio requests |
| --- | ---: | ---: | ---: |
| Standard | $4 â€” check current AWS pricing | 234 / 1,000,000 x $4 = $0.000936 | 870 / 1,000,000 x $4 = $0.003480 |
| Neural | $16 â€” check current AWS pricing | 234 / 1,000,000 x $16 = $0.003744 | 870 / 1,000,000 x $16 = $0.013920 |
| Generative | $30 â€” check current AWS pricing | 234 / 1,000,000 x $30 = $0.007020 | 870 / 1,000,000 x $30 = $0.026100 |
| Long-form | $100 â€” check current AWS pricing | 234 / 1,000,000 x $100 = $0.023400 | 870 / 1,000,000 x $100 = $0.087000 |

This is a cost per generation, not a monthly bill. Regenerating a passage incurs another request; CloudFront playback has its own delivery cost. The smoke receipt labels its audio figure an estimate and prints the provisional price used.
