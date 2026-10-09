# Link purpose (WCAG 2.4.4) and where links lead

WCAG 2.4.4 asks that the purpose of each link can be told from its text, alone or with its programmatically determined context. Rampa judges each link with a model, and gives that model facts it cannot guess:

- **The link's context**: its sentence, paragraph, list item (and the items it is nested in), table cell and the header cells of that cell, the heading it sits under, and its `aria-describedby` description. A short `div` or `span` around a link counts as its sentence. A block that holds nothing but links is no context.
- **Where the link leads**: the part of the page a `#part` link points to, and, for other links, what Rampa read at the address before judging: a page's title, first `h1`, meta description and the part a `#fragment` points to, or a file's type and size.
- **The links that share its text**: how many there are, how many different places they lead to, and whether the context of each tells it apart from the ones that lead elsewhere.

With these, the model can report three problems besides a generic text such as "click here":

| Problem | Example | Message |
| --- | --- | --- |
| `mismatch` | "Pricing" leads to a blog post | The link text "Pricing" does not match where the link leads: a page titled "Launch week recap". |
| `ambiguous` | two "Download" links to two price lists, nothing around them says which is which | The link text "Download" is shared by 2 links that lead to 2 different places, and nothing around this one tells it apart. |
| `url_or_filename` | `report_final_v2.pdf` | The link text … is an address, not a purpose. |

Verification keeps a `mismatch` only when the destination was read (the `#part` it points to, or a title or main heading read at its address that is not the site's name, not shared by pages at other addresses and not a not-found page; see [criteria.md](criteria.md#244-link-purpose-in-context)), and an `ambiguous` only when the facts say other links with the same text lead elsewhere from the same context. The destination never makes an unclear text pass: people do not see it before they follow the link.

`examples/link-purpose/news.html` shows all three, and `news-fixed.html` the same page fixed:

```sh
rampa check examples/link-purpose/news.html --criteria 2.4.4
```

## What is read, and what is not

`--follow-links <policy>` on `rampa check` and `rampa eval`:

| Policy | Web page | Local file |
| --- | --- | --- |
| `none` | nothing | nothing |
| `same-origin` (default) | pages of the same origin (scheme, host and port) | local files in the working directory or the page's own folder |
| `all` | also other sites, never a private or loopback address unless the page itself is on one | also public web pages |

- Only visible links with a name are read, those in the content before those in menus, header and footer.
- Links are read only when a criterion needs their destinations (2.4.4) and the judgment layer runs: not with `--no-llm`, and never for a snapshot `.json` you check later; a saved snapshot carries the facts it was recorded with, so it replays offline.
- A broken link is not a WCAG failure, so it is never a finding. A 404, a timeout, a sign-in wall (401, or a redirect to a login address) and a redirect to the home page all read as "nothing known": the model judges the text and its context alone. The status stays in the snapshot.

## Limits and privacy

- At most 40 addresses per page, 4 at a time, 8 seconds each (redirects included), 5 redirects, and the first 512 KB of an HTML page. For other files the request stops after the headers, which give their type and size.
- `GET` requests with a `User-Agent` that names Rampa and links to this repository, no cookies and no credentials: a link is read as a stranger would see it.
- HTTP redirects and instant `<meta http-equiv="refresh" content="0; url=…">` are followed, as browsers and the W3C ACT rules treat them.
- A site that answers 429 or 503 is not asked again in that run.
- Every address is read once per run, however many pages link to it. Web pages are also kept for an hour in `.rampa/destinations`, so a second run neither asks the site again nor changes the prompts (and with them the cached judgments). Local files, local servers and failures are read again every run. Delete the folder to read everything again.
- Keys in `snapshot.destinations` are the hrefs as written, and local files never record their path, so a saved snapshot of a local page carries no path of your machine.
- What Rampa reads at a destination goes into the prompt, so a hosted model provider sees the titles and descriptions of the pages your page links to. Use `--follow-links none`, or a local model, when that matters.
- `robots.txt` is not read: Rampa reads only the pages the checked page links to, one level deep, like a link preview.

## In `rampa eval`

The eval follows `same-origin` links by default. The outcomes of ACT rule fd3a94 (links with the same name and context serve an equivalent purpose) depend on where its links lead, an instant redirect or a copy of a page, and those pages are on the same W3C host as the test pages the eval already loads. Third-party sites the test pages link to are never contacted. `--follow-links none` measures the text and context alone.

Two corrupted pairs break the passed examples of c487ae and 5effbb: `link-generic` gives every link whose text stands alone the text "Check it out", and `link-mismatch` points every link at a paragraph about opening hours added to the page. Neither uses words from the prompt.

## Known limits

- A scripted link without an `href` (`<span role="link" onclick=…>`) has no known destination, so it never joins the comparison of links that share a text.
- Pages are read without running their scripts. A page that builds its content in the browser shows only what its HTML says before scripts run.
- Two pages count as one place when their title, `h1` and description are identical and only their path differs. The same path with another query string stays another place, since the query may change what the page shows.
- The ACT exception for links "ambiguous to users in general" is not detected: two links with the same text that lead to different places, with nothing around them for anyone, are reported as ambiguous.
