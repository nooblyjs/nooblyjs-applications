# Extension Icons

To complete the extension setup, please add the following icon files:

- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

You can create these from the `icon.svg` file or use any PNG images with a "W" logo or wiki icon.

## Quick way to create icons:

If you have ImageMagick installed:

```bash
convert -background "#0052cc" -fill white -font Arial-Bold -pointsize 64 -size 128x128 -gravity center label:W icon128.png
convert icon128.png -resize 48x48 icon48.png
convert icon128.png -resize 16x16 icon16.png
```

Or use an online converter to convert icon.svg to PNG at different sizes.
