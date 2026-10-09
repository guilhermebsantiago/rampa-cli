# Image-only screens

Some screens exist only as pixels: a design mock before any code, a kiosk or a TV app you cannot inspect, a game drawn on a canvas. `rampa check screen.png` checks the one thing pixels can support, text contrast, and says plainly that everything else could not be checked.

```sh
rampa check screen.png --model ollama:gemma4:12b     # needs a model with vision to find the text
rampa check screen.png --offline --model ollama:gemma4:12b   # replay the cached answers, no model call
rampa check screen.png --save recordings              # record the snapshot and the measurements
rampa check examples/image/sign-in.png                # the example in this repository
```

When the screen has an accessibility tree, check that instead: a web page, an [Android screen](android.md) or an [iOS export](ios.md). Every check that runs on an image runs there too, with real element boxes instead of boxes a model drew.

## What it does

1. **Find the text.** A vision model lists each piece of text it sees: the text, what it is (a heading, a label, a placeholder, a logo…) and a box in thousandths of the image. One call per image, cached like a judgment.
2. **Check every box.** Models place boxes loosely, so each box is a claim to check, not a fact:
   - a box outside the image, inverted, or as large as much of the screen is dropped;
   - a box that holds no text pixels (only one flat color, or only a border) is dropped;
   - the model then reads each remaining box, cut out of the image, without being told what to expect. When that reading does not contain the words it claimed, the box landed somewhere else, and it is dropped.
3. **Measure.** Inside each box that held up, contrast is measured deterministically from the pixels, the same way as on [app screens](android.md#what-is-checked): below 3:1 fails at any size; between 3:1 and 4.5:1 is enough only for large text, whose size an image does not give, so it is listed for a person; text on an image or a gradient, or with strokes too thin to hold their color, is listed as not measurable. Text the model marks as a logo or as an inactive control is exempt, as WCAG says.

Findings come out at medium confidence, and each one says that a model located it in the image and that it was not read from an accessibility tree. The report counts the boxes that were dropped.

## What it does not check, and why

| Criterion | Why not from an image |
| --- | --- |
| 1.4.5 Images of Text | A screenshot is pixels from end to end: text the platform renders and a picture of text look the same. Telling them apart needs the tree. |
| 1.1.1 Non-text Content | The question is whether each image has a text alternative that serves the same purpose, and a screenshot carries no alternatives. |
| 1.4.11 Non-text Contrast | It needs to know which pixels are a control's boundary or a graphic that conveys something; from pixels alone that is a model's guess. |
| 1.4.1 Use of Color | It needs to know what a color means on the screen; a model could guess, but nothing in an image could verify the guess. |
| 2.4.6 Headings and Labels | A model could read the visible headings, but checking its claims against text it read itself would not be verification. |
| Names, roles, states, focus order, keyboard, language (1.3.1, 2.1.1, 2.4.3, 3.1.1, 4.1.2…) | They are properties of the accessibility tree, which an image does not have. |

Rampa does not list the images it sees either: an inventory nobody can check against an alternative is noise.

## How well it works

On `examples/image/sign-in.png` (a sign-in mock rendered at 2x with five low-contrast texts), `ollama:gemma4:12b` listed nine pieces of text with the right words and the right horizontal positions, but its boxes drifted upward the further down the text was: 0.2% of the image height at the top, 14.7% at the bottom, more than the space between two lines. Verification dropped eight of the nine boxes: three held no text, and five read as other words, among them the box named "Summer sale: 30% off", which sat on the "Forgot password?" link. The one box that held up, "Welcome back", measured 16.1:1. So with this model the surface reported nothing false, and also measured almost nothing. Models trained to point at things in images (grounding) should keep more boxes; none was tried here.

Measurements also need the right pixels:

- **PNG only.** JPEG and other lossy formats change the very colors contrast is measured from; convert or export to PNG.
- **Resolution.** Strokes need to be at least three pixels wide to hold their true color, so export mocks at 2x or more. At 1x, normal-size text is listed as not measurable.
- **Colors** are read as sRGB, as most screenshots and design tools write them.
