# 1.1.1 on the W3C ACT cases, offline: before against after, before-2

| Run | Rows | Same outcome as the reference | New model calls | Cached calls | Output tokens | Message changes | Usage changes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | 56 | – | 0 | 44 | 2384 | – | – |
| after | 56 | 56 / 56 | 0 | 44 | 2382 | 3 | 1 |
| before-2 | 56 | 56 / 56 | 0 | 44 | 2382 | 0 | 1 |

Differences row by row:

- after, qt1vmo Failed Example 1: html > body > img: The text alternative "ERCIM logo" describes something the image does not show. → html > body > img: The text alternative "ERCIM logo" names a label, not what the image conveys here.
- after, qt1vmo Failed Example 2: html > body > svg: The text alternative "W3C" describes something the image does not show. → html > body > svg: The text alternative "W3C" names a label, not what the image conveys here.
- after, qt1vmo Failed Example 3: #logo: The text alternative "HTML 5 logo" describes something the image does not show. → #logo: The text alternative "HTML 5 logo" names a label, not what the image conveys here.
- after, e88epe Passed Example 3: usage 1 cached, 841 in / 67 out → 1 cached, 841 in / 65 out
- before-2, e88epe Passed Example 3: usage 1 cached, 841 in / 67 out → 1 cached, 841 in / 65 out
