# Third-party notices

Third-party components redistributed with fizzle (as opposed to ordinary npm
dependencies, whose licenses ship in `node_modules/`):

## MediaPipe Selfie Segmenter (person())

- `src/assets/selfie_segmenter.tflite` and
  `src/assets/selfie_multiclass_256x256.tflite` — the segmentation models,
  committed here so builds don't depend on Google's servers. From the
  [MediaPipe image segmenter model card](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter#selfie-model).
- `@mediapipe/tasks-vision` — the wasm/JS runtime that runs it, copied into
  build output by Vite.

Both are Copyright Google LLC, licensed under the Apache License, Version 2.0:
<https://www.apache.org/licenses/LICENSE-2.0>. Apache-2.0 is a permissive
license and is one-way compatible with this project's AGPL-3.0-only license.

## Helvetiker (the built-in text3d font)

- `src/fonts/helvetiker_regular.typeface.json` and
  `src/fonts/helvetiker_bold.typeface.json` — the typeface data `text3d()`
  renders with until a named font arrives. These are the typeface.js
  conversions distributed with the three.js examples.

Copyright (c) 2004 by MAGENTA Ltd. All Rights Reserved. Licensed under the
MgOpen font license, which is permissive and compatible with this project's
AGPL-3.0-only license. fizzle redistributes both files unmodified. Its terms,
reproduced in full as the license requires:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of the fonts accompanying this license ("Fonts") and associated documentation
> files (the "Font Software"), to reproduce and distribute the Font Software,
> including without limitation the rights to use, copy, merge, publish,
> distribute, and/or sell copies of the Font Software, and to permit persons to
> whom the Font Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright and this permission notice shall be included in all
> copies of one or more of the Font Software typefaces.
>
> The Font Software may be modified, altered, or added to, and in particular
> the designs of glyphs or characters in the Fonts may be modified and
> additional glyphs or characters may be added to the Fonts, only if the fonts
> are renamed to names not containing the word "MgOpen", or if the
> modifications are accepted for inclusion in the Font Software itself by the
> each appointed Administrator.
>
> This License becomes null and void to the extent applicable to Fonts or Font
> Software that has been modified and is distributed under the "MgOpen" name.
>
> The Font Software may be sold as part of a larger software package but no
> copy of one or more of the Font Software typefaces may be sold by itself.
>
> THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
> OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
> TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL MAGENTA OR PERSONS OR BODIES IN
> CHARGE OF ADMINISTRATION AND MAINTENANCE OF THE FONT SOFTWARE BE LIABLE FOR
> ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING ANY GENERAL, SPECIAL,
> INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF THE USE OR INABILITY TO USE
> THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE FONT SOFTWARE.
