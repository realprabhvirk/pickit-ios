# Real-device check

Playwright runs on Linux and isn't iOS Safari. These need an iPhone. Deploy first (README > Deploy), delete any old PicKit icon, add it to the Home Screen again, then go through the list. Anything that fails, a screenshot helps.

## 1. Install and offline

- [ ] Launch from the Home Screen: no Safari chrome, plain white (light) or black (dark) launch image, then the picker.
- [ ] Settings > **Ready Offline** says **Ready**. Tap it: every file stored, and JPEG, PNG, OxiPNG and WebP all **Works**.
- [ ] **Airplane Mode** on, swipe PicKit away, open it again. Open a photo, edit it, and Export as WebP: the size appears and Share works.

## 2. Editing

- [ ] **Crop**: drag corners and edges (they're easy to grab), switch to Square, move the frame, ✓. Undo puts it back.
- [ ] **Resize**: type a width in mm; the keyboard doesn't hide the field. Enlarging shows a warning.
- [ ] **Rotate**: Left, Right, both flips; straighten with the slider and see the live preview with the grid.
- [ ] **Markup**: draw with a finger; pinch with two fingers zooms instead of drawing. Arrow, rectangle, ellipse, highlighter. Text: tap, type, change the font, Done; the keyboard bar stays above the keyboard. Select a drawing, drag it, change its colour, delete it. Eraser cuts a pen line.
- [ ] **Undo/redo** buttons step through all of the above.
- [ ] **Resize For**: pick Instagram Portrait; the frame shows what's kept and the note says what's cut.
- [ ] **Photo switcher**: open three photos, switch between them; each keeps its own edits and undo.
- [ ] **Rename**: tap the name at the top.

## 3. Privacy

- [ ] **Privacy > Redact** a box over something, export, open the export in Photos and zoom in: solid black.
- [ ] **Blur** and **Pixelate** with the brush.
- [ ] Open a photo taken with Location Services on. **Details** shows its location and camera. **Make a Copy Without Details**, share it to Files, then check it in Photos (swipe up / ⓘ): no location. A normal export also has none, unless "Remove Location & Camera Info" is off.
- [ ] HEIC originals: the clean copy says it was re-encoded as JPEG.

## 4. Background

- [ ] **Remove** brush over the background shows a checkerboard; **Keep** brings it back; the brush stays the same size on screen when zoomed. ✓, then Export as PNG: transparency is kept. JPEG says transparent areas become white.

## 5. Export

- [ ] **Share** opens the iOS share sheet immediately (Save Image, AirDrop, Messages). It must not say the action isn't allowed.
- [ ] **Copy**, then paste into Notes or Messages.
- [ ] **Save** offers Save to Files.
- [ ] **Compress** to 250 KB: the result fits, and the size shown matches the file.

## 6. Batch

- [ ] Batch > choose 10+ photos, Compress, run, Cancel halfway, run again; Share them all, and Save as ZIP into Files (it opens in Files).
- [ ] Rename with `Photo {number}`; a clash is flagged before anything is made. Undo puts the settings back.

## 7. Resume

- [ ] Edit two photos, swipe PicKit away, open it again: the picker offers **Resume**, and the edits are there (undo history starts fresh).

## 8. Big photos and memory

- [ ] Open a **48 MP** photo (ProRAW on the 14 Pro, or HEIF Max if your iOS offers it): a **Reduced to 16.7 MP for editing** notice, the photo shows (not blank), Details shows the original 8064 × 6048. Crop and export it without the app reloading.
- [ ] Open five 12 MP photos and edit each: no reload. If PicKit says memory is full, that's expected; tell me how many it took.

## 9. Look and feel

- [ ] Status bar readable on the picker, Settings and editor, light and dark (light screens have a dark scrim behind it). Say if the scrim looks wrong.
- [ ] Editor buttons readable over a bright photo and a dark one, and they keep the same look while zooming (light glass in light mode, dark in dark mode).
- [ ] Text in the name capsule at the top is sharp, not soft.
- [ ] Gestures: pinch, pan and flick feel smooth; sheets drag and flick between half and full height; Settings swipes back from the left edge.
- [ ] Rotate to landscape: a polite notice, nothing broken.
- [ ] Largest text sizes: nothing clipped or overlapping.
