# Counterfactual simulations on the judgment findings a user sees (default threshold)

Base: studies 2 (run asked again after the 2.4.4/2.4.6 change) and 3, 218 labelled judgment findings: 72 TP, 137 FP, 9 uncertain; precision 0.34 (0.28–0.41).
218 of them joined to today's facts and the recorded answer; 0 did not (a candidate today's code no longer makes, or a hidden-image question).
Verifier answers available: 186 findings.

## Each intervention alone

| intervention | FP removed | TP lost | unc. removed | pooled precision before → after | s2-after before → after | s3 before → after | s3 dev | s3 test |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| T0 today's main (15b1149) verification on the recorded answers: 1.1.1 claims it now discards | 23 | 2 | 2 | 0.34 (0.28–0.41) → 0.38 (0.31–0.45) | 0.44 (0.33–0.55) → 0.60 (0.46–0.72) (−21 FP, −2 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−2 FP, −0 TP) | 0.43 (0.29–0.59) → 0.46 (0.30–0.62) (−2 FP, −0 TP) | 0.24 (0.17–0.34) → 0.24 (0.17–0.34) (−0 FP, −0 TP) |
| I1 collector: a page rendered without its stylesheet (ufpe.br) reports no judgment finding; proxy here: a link in a list of >100 links | 50 | 0 | 0 | 0.34 (0.28–0.41) → 0.45 (0.38–0.53) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.47 (0.36–0.57) (−50 FP, −0 TP) | 0.43 (0.29–0.59) → 0.43 (0.29–0.59) (−0 FP, −0 TP) | 0.24 (0.17–0.34) → 0.49 (0.36–0.63) (−50 FP, −0 TP) |
| I1b the same with a smaller list (>50 links) | 50 | 0 | 0 | 0.34 (0.28–0.41) → 0.45 (0.38–0.53) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.47 (0.36–0.57) (−50 FP, −0 TP) | 0.43 (0.29–0.59) → 0.43 (0.29–0.59) (−0 FP, −0 TP) | 0.24 (0.17–0.34) → 0.49 (0.36–0.63) (−50 FP, −0 TP) |
| I2 1.1.1 "describes something the image does not show" becomes a suggestion (no fact can ground it) | 52 | 7 | 2 | 0.34 (0.28–0.41) → 0.43 (0.36–0.51) | 0.44 (0.33–0.55) → 0.57 (0.43–0.70) (−20 FP, −4 TP) | 0.29 (0.22–0.38) → 0.37 (0.28–0.46) (−32 FP, −3 TP) | 0.43 (0.29–0.59) → 0.74 (0.51–0.88) (−16 FP, −2 TP) | 0.24 (0.17–0.34) → 0.28 (0.19–0.39) (−16 FP, −1 TP) |
| I2b 1.1.1 wrong_content stays a finding only when the model's description shares no content word with the alternative | 30 | 2 | 1 | 0.34 (0.28–0.41) → 0.40 (0.33–0.47) | 0.44 (0.33–0.55) → 0.51 (0.38–0.63) (−12 FP, −2 TP) | 0.29 (0.22–0.38) → 0.34 (0.26–0.43) (−18 FP, −0 TP) | 0.43 (0.29–0.59) → 0.55 (0.38–0.72) (−8 FP, −0 TP) | 0.24 (0.17–0.34) → 0.27 (0.19–0.37) (−10 FP, −0 TP) |
| I3 1.1.1 fact: an alternative that names the language of its language link (flags) | 3 | 0 | 0 | 0.34 (0.28–0.41) → 0.35 (0.29–0.42) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−3 FP, −0 TP) | 0.43 (0.29–0.59) → 0.47 (0.31–0.63) (−3 FP, −0 TP) | 0.24 (0.17–0.34) → 0.24 (0.17–0.34) (−0 FP, −0 TP) |
| I4 1.1.1 fact: an alternative whose words are all in the text next to it (icon beside a heading or card) | 14 | 2 | 0 | 0.34 (0.28–0.41) → 0.36 (0.30–0.43) | 0.44 (0.33–0.55) → 0.45 (0.33–0.57) (−4 FP, −2 TP) | 0.29 (0.22–0.38) → 0.32 (0.24–0.40) (−10 FP, −0 TP) | 0.43 (0.29–0.59) → 0.43 (0.29–0.59) (−0 FP, −0 TP) | 0.24 (0.17–0.34) → 0.27 (0.19–0.37) (−10 FP, −0 TP) |
| I5 1.1.1 fact: a linked logo that names the site and leads to its home page | 1 | 0 | 1 | 0.34 (0.28–0.41) → 0.35 (0.28–0.41) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−1 FP, −0 TP) | 0.43 (0.29–0.59) → 0.44 (0.30–0.60) (−1 FP, −0 TP) | 0.24 (0.17–0.34) → 0.24 (0.17–0.34) (−0 FP, −0 TP) |
| I5b 1.1.1 fact: a functional image whose alternative shares two thirds of its words with the link's title, destination or caption | 1 | 0 | 1 | 0.34 (0.28–0.41) → 0.35 (0.28–0.41) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−1 FP, −0 TP) | 0.43 (0.29–0.59) → 0.44 (0.30–0.60) (−1 FP, −0 TP) | 0.24 (0.17–0.34) → 0.24 (0.17–0.34) (−0 FP, −0 TP) |
| I6 2.4.4 fact: a raw address inside a sentence is a suggestion, not a finding | 3 | 0 | 0 | 0.34 (0.28–0.41) → 0.35 (0.29–0.42) | 0.44 (0.33–0.55) → 0.45 (0.34–0.57) (−2 FP, −0 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−1 FP, −0 TP) | 0.43 (0.29–0.59) → 0.44 (0.30–0.60) (−1 FP, −0 TP) | 0.24 (0.17–0.34) → 0.24 (0.17–0.34) (−0 FP, −0 TP) |
| I7 2.4.4 fact: "ambiguous" links that sit in one list of >50 links | 50 | 0 | 0 | 0.34 (0.28–0.41) → 0.45 (0.38–0.53) | 0.44 (0.33–0.55) → 0.44 (0.33–0.55) (−0 FP, −0 TP) | 0.29 (0.22–0.38) → 0.47 (0.36–0.57) (−50 FP, −0 TP) | 0.43 (0.29–0.59) → 0.43 (0.29–0.59) (−0 FP, −0 TP) | 0.24 (0.17–0.34) → 0.49 (0.36–0.63) (−50 FP, −0 TP) |
| I8 all 2.4.6, 2.4.2 and 3.3.2 judgment findings become suggestions | 9 | 0 | 0 | 0.34 (0.28–0.41) → 0.36 (0.30–0.43) | 0.44 (0.33–0.55) → 0.48 (0.36–0.60) (−6 FP, −0 TP) | 0.29 (0.22–0.38) → 0.30 (0.23–0.38) (−3 FP, −0 TP) | 0.43 (0.29–0.59) → 0.43 (0.29–0.59) (−0 FP, −0 TP) | 0.24 (0.17–0.34) → 0.25 (0.17–0.35) (−3 FP, −0 TP) |
| I9 all 2.4.4 findings become suggestions (only facts, no model, would remain) | 59 | 12 | 3 | 0.34 (0.28–0.41) → 0.43 (0.35–0.52) | 0.44 (0.33–0.55) → 0.42 (0.31–0.54) (−4 FP, −5 TP) | 0.29 (0.22–0.38) → 0.45 (0.34–0.56) (−55 FP, −7 TP) | 0.43 (0.29–0.59) → 0.41 (0.26–0.58) (−1 FP, −2 TP) | 0.24 (0.17–0.34) → 0.47 (0.33–0.63) (−54 FP, −5 TP) |
| V-A second pass, framing A (criterion rules, one word): drop when P(fail) < 0.5 | 30 | 3 | 0 | 0.34 (0.28–0.41) → 0.39 (0.32–0.47) | 0.44 (0.33–0.55) → 0.52 (0.39–0.64) (−12 FP, −1 TP) | 0.29 (0.22–0.38) → 0.33 (0.25–0.42) (−18 FP, −2 TP) | 0.43 (0.29–0.59) → 0.56 (0.37–0.73) (−10 FP, −2 TP) | 0.24 (0.17–0.34) → 0.26 (0.18–0.36) (−8 FP, −0 TP) |
| V-B second pass, framing B (is the claim correct?): drop when P(yes) < 0.5 | 50 | 5 | 1 | 0.34 (0.28–0.41) → 0.44 (0.36–0.51) | 0.44 (0.33–0.55) → 0.62 (0.47–0.74) (−23 FP, −3 TP) | 0.29 (0.22–0.38) → 0.36 (0.27–0.45) (−27 FP, −2 TP) | 0.43 (0.29–0.59) → 0.65 (0.45–0.81) (−13 FP, −1 TP) | 0.24 (0.17–0.34) → 0.27 (0.19–0.38) (−14 FP, −1 TP) |
| V-C second pass, framing C (symmetric question): drop when P(fail) < 0.5 | 43 | 4 | 0 | 0.34 (0.28–0.41) → 0.42 (0.35–0.50) | 0.44 (0.33–0.55) → 0.60 (0.46–0.72) (−21 FP, −2 TP) | 0.29 (0.22–0.38) → 0.34 (0.26–0.43) (−22 FP, −2 TP) | 0.43 (0.29–0.59) → 0.58 (0.39–0.76) (−11 FP, −2 TP) | 0.24 (0.17–0.34) → 0.27 (0.19–0.37) (−11 FP, −0 TP) |
| V-2of3 keep only when at least 2 of the 3 framings say fail | 42 | 4 | 0 | 0.34 (0.28–0.41) → 0.42 (0.34–0.49) | 0.44 (0.33–0.55) → 0.61 (0.47–0.74) (−22 FP, −2 TP) | 0.29 (0.22–0.38) → 0.33 (0.25–0.42) (−20 FP, −2 TP) | 0.43 (0.29–0.59) → 0.54 (0.35–0.71) (−9 FP, −2 TP) | 0.24 (0.17–0.34) → 0.27 (0.19–0.37) (−11 FP, −0 TP) |
| V-3of3 keep only when all 3 framings say fail | 61 | 6 | 1 | 0.34 (0.28–0.41) → 0.46 (0.38–0.55) | 0.44 (0.33–0.55) → 0.69 (0.54–0.81) (−28 FP, −3 TP) | 0.29 (0.22–0.38) → 0.37 (0.28–0.47) (−33 FP, −3 TP) | 0.43 (0.29–0.59) → 0.82 (0.59–0.94) (−18 FP, −2 TP) | 0.24 (0.17–0.34) → 0.28 (0.19–0.38) (−15 FP, −1 TP) |
| V-mean keep only when the mean P(fail) over the framings is at least 0.9 | 62 | 6 | 2 | 0.34 (0.28–0.41) → 0.47 (0.39–0.55) | 0.44 (0.33–0.55) → 0.71 (0.56–0.82) (−29 FP, −3 TP) | 0.29 (0.22–0.38) → 0.37 (0.28–0.47) (−33 FP, −3 TP) | 0.43 (0.29–0.59) → 0.82 (0.59–0.94) (−18 FP, −2 TP) | 0.24 (0.17–0.34) → 0.28 (0.19–0.38) (−15 FP, −1 TP) |

## Stacks (applied together)

| intervention | FP removed | TP lost | unc. removed | pooled precision before → after | s2-after before → after | s3 before → after | s3 dev | s3 test |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| S1 = T0 + I1 (collector guard) | 73 | 2 | 2 | 0.34 (0.28–0.41) → 0.52 (0.44–0.61) | 0.44 (0.33–0.55) → 0.60 (0.46–0.72) (−21 FP, −2 TP) | 0.29 (0.22–0.38) → 0.48 (0.37–0.58) (−52 FP, −0 TP) | 0.43 (0.29–0.59) → 0.46 (0.30–0.62) (−2 FP, −0 TP) | 0.24 (0.17–0.34) → 0.49 (0.36–0.63) (−50 FP, −0 TP) |
| S2 = S1 + I3 + I4 + I5 + I6 (new facts) | 90 | 2 | 3 | 0.34 (0.28–0.41) → 0.60 (0.51–0.68) | 0.44 (0.33–0.55) → 0.62 (0.48–0.75) (−23 FP, −2 TP) | 0.29 (0.22–0.38) → 0.58 (0.46–0.69) (−67 FP, −0 TP) | 0.43 (0.29–0.59) → 0.53 (0.36–0.70) (−7 FP, −0 TP) | 0.24 (0.17–0.34) → 0.62 (0.46–0.75) (−60 FP, −0 TP) |
| S3 = S2 + I8 (2.4.6, 2.4.2, 3.3.2 suggest only) | 99 | 2 | 3 | 0.34 (0.28–0.41) → 0.65 (0.55–0.73) | 0.44 (0.33–0.55) → 0.71 (0.56–0.83) (−29 FP, −2 TP) | 0.29 (0.22–0.38) → 0.61 (0.49–0.71) (−70 FP, −0 TP) | 0.43 (0.29–0.59) → 0.53 (0.36–0.70) (−7 FP, −0 TP) | 0.24 (0.17–0.34) → 0.67 (0.50–0.80) (−63 FP, −0 TP) |
| S4 = S3 + I2 (wrong_content suggest only) | 122 | 7 | 4 | 0.34 (0.28–0.41) → 0.81 (0.71–0.88) | 0.44 (0.33–0.55) → 0.82 (0.66–0.92) (−35 FP, −4 TP) | 0.29 (0.22–0.38) → 0.80 (0.67–0.89) (−87 FP, −3 TP) | 0.43 (0.29–0.59) → 0.82 (0.59–0.94) (−18 FP, −2 TP) | 0.24 (0.17–0.34) → 0.79 (0.62–0.90) (−69 FP, −1 TP) |
| S5 = S3 + V-2of3 (second pass on what is left) | 113 | 4 | 3 | 0.34 (0.28–0.41) → 0.74 (0.64–0.82) | 0.44 (0.33–0.55) → 0.83 (0.68–0.92) (−35 FP, −2 TP) | 0.29 (0.22–0.38) → 0.68 (0.55–0.79) (−78 FP, −2 TP) | 0.43 (0.29–0.59) → 0.58 (0.39–0.76) (−11 FP, −2 TP) | 0.24 (0.17–0.34) → 0.75 (0.58–0.87) (−67 FP, −0 TP) |
| S6 = S3 + V-3of3 | 123 | 6 | 3 | 0.34 (0.28–0.41) → 0.82 (0.73–0.89) | 0.44 (0.33–0.55) → 0.88 (0.73–0.95) (−37 FP, −3 TP) | 0.29 (0.22–0.38) → 0.79 (0.65–0.88) (−86 FP, −3 TP) | 0.43 (0.29–0.59) → 0.82 (0.59–0.94) (−18 FP, −2 TP) | 0.24 (0.17–0.34) → 0.77 (0.59–0.88) (−68 FP, −1 TP) |
| S7 = S4 + V-2of3 | 126 | 8 | 4 | 0.34 (0.28–0.41) → 0.85 (0.76–0.92) | 0.44 (0.33–0.55) → 0.88 (0.72–0.95) (−37 FP, −4 TP) | 0.29 (0.22–0.38) → 0.84 (0.70–0.92) (−89 FP, −4 TP) | 0.43 (0.29–0.59) → 0.87 (0.62–0.96) (−19 FP, −3 TP) | 0.24 (0.17–0.34) → 0.82 (0.64–0.92) (−70 FP, −1 TP) |
| S8 = S3 + V-3of3 on the 1.1.1 claims that rest on the model's reading only (wrong_content, functional) | 123 | 4 | 3 | 0.34 (0.28–0.41) → 0.83 (0.73–0.90) | 0.44 (0.33–0.55) → 0.88 (0.73–0.95) (−37 FP, −3 TP) | 0.29 (0.22–0.38) → 0.80 (0.66–0.89) (−86 FP, −1 TP) | 0.43 (0.29–0.59) → 0.83 (0.61–0.94) (−18 FP, −1 TP) | 0.24 (0.17–0.34) → 0.77 (0.60–0.89) (−68 FP, −0 TP) |
| S9 = S8 with min P(fail) over the framings ≥ 0.9 instead of three votes | 123 | 4 | 3 | 0.34 (0.28–0.41) → 0.83 (0.73–0.90) | 0.44 (0.33–0.55) → 0.88 (0.73–0.95) (−37 FP, −3 TP) | 0.29 (0.22–0.38) → 0.80 (0.66–0.89) (−86 FP, −1 TP) | 0.43 (0.29–0.59) → 0.83 (0.61–0.94) (−18 FP, −1 TP) | 0.24 (0.17–0.34) → 0.77 (0.60–0.89) (−68 FP, −0 TP) |

## Precision against coverage: 1.1.1 reading claims (wrong_content, functional) left after the facts of S3, by the verifier's min P(fail) over the three framings

55 decided findings: 23 TP, 32 FP.

| threshold on min P(fail) | kept TP | kept FP | precision of what is kept | share of TP kept |
| --- | ---: | ---: | --- | ---: |
| 0.0 | 23 | 32 | 0.42 (0.30–0.55) | 100% |
| 0.5 | 21 | 8 | 0.72 (0.54–0.85) | 91% |
| 0.7 | 21 | 8 | 0.72 (0.54–0.85) | 91% |
| 0.9 | 21 | 8 | 0.72 (0.54–0.85) | 91% |
| 0.95 | 21 | 7 | 0.75 (0.57–0.87) | 91% |
| 0.99 | 21 | 5 | 0.81 (0.62–0.91) | 91% |

## Per criterion and claim, today (base), for the report-or-suggest decision

| criterion · claim | TP | FP | unc | precision | s2-after | s3 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| 1.1.1 · decorative | 3 | 0 | 0 | 1.00 (0.44–1.00) | 0/0/0 | 3/0/0 |
| 1.1.1 · functional-button | 0 | 2 | 0 | 0.00 (0.00–0.66) | 0/2/0 | 0/0/0 |
| 1.1.1 · functional-link | 18 | 14 | 4 | 0.56 (0.39–0.72) | 5/8/3 | 13/6/1 |
| 1.1.1 · generic-alt | 3 | 0 | 0 | 1.00 (0.44–1.00) | 0/0/0 | 3/0/0 |
| 1.1.1 · placeholder | 9 | 1 | 0 | 0.90 (0.60–0.98) | 6/1/0 | 3/0/0 |
| 1.1.1 · wrong_content | 7 | 52 | 2 | 0.12 (0.06–0.23) | 4/20/1 | 3/32/1 |
| 1.3.5 · 1.3.5:other | 19 | 0 | 0 | 1.00 (0.83–1.00) | 11/0/0 | 8/0/0 |
| 2.4.4 · link-ambiguous | 12 | 55 | 2 | 0.18 (0.11–0.29) | 5/2/0 | 7/53/2 |
| 2.4.4 · link-generic | 0 | 1 | 1 | 0.00 (0.00–0.79) | 0/0/0 | 0/1/1 |
| 2.4.4 · link-url | 0 | 3 | 0 | 0.00 (0.00–0.56) | 0/2/0 | 0/1/0 |
| 2.4.6 · label-says-nothing | 0 | 6 | 0 | 0.00 (0.00–0.39) | 0/4/0 | 0/2/0 |
| 3.1.2 · 3.1.2:other | 1 | 0 | 0 | 1.00 (0.21–1.00) | 1/0/0 | 0/0/0 |
| 3.3.2 · no-visible-instruction | 0 | 3 | 0 | 0.00 (0.00–0.56) | 0/2/0 | 0/1/0 |

## The verifier signal, where it answered


### 1.1.1: 109 decided findings with answers

| framing | AUROC of P(fail) vs label | P(fail) ≥ 0.5: TP kept / FP kept | P(fail) ≥ 0.9: TP kept / FP kept | mean P(fail) on TP / on FP |
| --- | --- | --- | --- | --- |
| A | 0.89 | 37/40 · 39/69 | 36/40 · 32/69 | 0.93 / 0.59 |
| B | 0.91 | 35/40 · 23/69 | 35/40 · 23/69 | 0.89 / 0.34 |
| C | 0.90 | 36/40 · 29/69 | 36/40 · 24/69 | 0.90 / 0.42 |

Votes (framings saying fail) by label: TP: {3: 34, 2: 2, 0: 2, 1: 2}, FP: {1: 20, 3: 13, 0: 20, 2: 16}

### 2.4.4: 64 decided findings with answers

| framing | AUROC of P(fail) vs label | P(fail) ≥ 0.5: TP kept / FP kept | P(fail) ≥ 0.9: TP kept / FP kept | mean P(fail) on TP / on FP |
| --- | --- | --- | --- | --- |
| A | 0.60 | 7/7 · 57/57 | 7/7 · 54/57 | 1.00 / 0.99 |
| B | 0.47 | 7/7 · 55/57 | 7/7 · 55/57 | 1.00 / 0.97 |
| C | 0.54 | 7/7 · 54/57 | 7/7 · 54/57 | 1.00 / 0.95 |

Votes (framings saying fail) by label: TP: {3: 7}, FP: {1: 2, 2: 1, 3: 54}

### 2.4.6: 4 decided findings with answers

| framing | AUROC of P(fail) vs label | P(fail) ≥ 0.5: TP kept / FP kept | P(fail) ≥ 0.9: TP kept / FP kept | mean P(fail) on TP / on FP |
| --- | --- | --- | --- | --- |
| A | nan | 0/0 · 4/4 | 0/0 · 4/4 | nan / 1.00 |
| B | nan | 0/0 · 2/4 | 0/0 · 2/4 | nan / 0.50 |
| C | nan | 0/0 · 4/4 | 0/0 · 4/4 | nan / 1.00 |

Votes (framings saying fail) by label: TP: {}, FP: {2: 2, 3: 2}
