# Real-device check: Phase 0

Playwright runs on Linux and isn't iOS Safari. These need your iPhone 14 Pro. Deploy first (README > Deploy), then go through the list and report back what you see. Anything that fails, a screenshot helps.

## 1. Install and offline

- [ ] Open the site in Safari. The **Add PicKit to your Home Screen** sheet appears once. Do the steps it describes. On iOS 26, is **Open as Web App** there and on by default?
- [ ] Launch from the Home Screen: no Safari chrome, the launch image is plain white (light) or black (dark), then the picker.
- [ ] Settings (••• > Settings) > **Ready Offline** says **Ready**. Tap it: Status **Ready Offline**, Files Stored **23**, Image Encoders **5 WASM files**, and JPEG, PNG, OxiPNG and WebP all say **Works**.
- [ ] Turn on **Airplane Mode**. Swipe PicKit away in the app switcher. Open it again from the Home Screen. It opens, you can choose a photo and it shows, and the Offline page still shows all four encoders **Works**.
- [ ] Settings > **Keep Storage**: what does it say? (Informational; nothing depends on it.)

## 2. Status bar (the black-translucent decision)

- [ ] Light mode, picker and Settings: can you read the time and battery at the top? There's a dark scrim behind them. Does it look acceptable or wrong?
- [ ] Dark mode, same screens: status bar readable, and no scrim visible.
- [ ] Editor, both modes, with a bright photo and a dark photo: status bar readable?

If the light-mode scrim looks bad, I'll switch to `default` (opaque bar, black text in light mode); that needs one rebuild and re-adding to the Home Screen.

## 3. Glass

- [ ] In the editor, open a **bright** photo (sky, snow, a white wall) and a **dark** one (night). The top buttons and the bottom toolbar should flip between black and white icons and stay readable in both. Any control hard to read?
- [ ] Does the glass look like glass (blurred, slightly bright edge, soft highlight top-left), or flat and grey?
- [ ] Settings > **Motion-Reactive Glass** on: iOS asks for motion access. After allowing, tilting the phone moves the highlight on the glass buttons. Subtle is right; tell me if it's too much or invisible.
- [ ] Turn on **Settings > Accessibility > Display & Text Size > Increase Contrast** (and separately **Reduce Transparency**): glass becomes solid with the same shapes.

## 4. Gestures and motion

- [ ] Editor: pinch zooms around your fingers, pan follows 1:1, a flick carries on and slows down, edges rubber-band and spring back. Double-tap toggles fit and 100%.
- [ ] Any stutter while pinching or panning a big photo? (Note: Safari may run page animations at 60 Hz even on ProMotion unless a Safari feature flag is changed, so 60 is acceptable; jank is not.)
- [ ] Tap a tool: the toolbar gives way and a sheet rises from where it was. Drag the sheet by its top to large and back; flick it down to dismiss; grab it while it's moving. The photo stays visible above it and refits as it moves.
- [ ] Settings: the Large Title collapses into the bar as you scroll; swipe from the left edge to go back (installed app only).
- [ ] Slider: drag the thumb; it grows into a lens while dragging.

## 5. Big photos

- [ ] Open a **48 MP** photo. On the 14 Pro that's a ProRAW shot (Camera > Settings > Formats > ProRAW & Resolution Control, 48 MP), or HEIF Max if your iOS offers it. It should show a **Reduced to 16.7 MP for editing** notice and display correctly (not blank), and Details shows the original 8064 × 6048. If a ProRAW file won't open at all, or iOS hands over a smaller converted copy, tell me which: both are useful to know.
- [ ] A normal 12 MP photo opens at full resolution (Details says so).

## 6. Odds and ends

- [ ] **Paste** button with an image copied in Photos: iOS shows its Paste prompt, then the image opens.
- [ ] Rotate the phone to landscape: a polite "Rotate to portrait" notice, nothing broken.
- [ ] Settings > **Haptics (Experimental)** on: do you feel a tick when you tap buttons and switches? (Best effort; may do nothing on your iOS version.)
- [ ] **Text Size** at the two largest settings (without and with Larger Accessibility Sizes): text grows; anything clipped or overlapping?
