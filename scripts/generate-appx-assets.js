/**
 * Generates every tile/logo/splash PNG required by the MSIX/APPX manifest,
 * using the NetDuo source icon. Run with: node scripts/generate-appx-assets.js
 *
 * Why: Microsoft Store policy 10.1.1.11 rejects packages that ship default
 * placeholder tile images. electron-builder only auto-generates a subset
 * (StoreLogo, Square44x44, Square150x150, Wide310x150) and the wide tile
 * ends up looking like a default. This script produces the full set with
 * the real app icon in every slot.
 */

const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'build', 'appx')

// Source icons
const ICON_FULL = path.join(ROOT, 'src', 'assets', 'netduo-app-icon-blue-max-1024.png') // fills tile
const ICON_PAD  = path.join(ROOT, 'src', 'assets', 'netduo-app-icon-blue-1024.png')      // padded + shadow

// Background matching the icon's blue (sampled from the gradient mid-tone)
const BG = { r: 125, g: 194, b: 238, alpha: 1 }

fs.mkdirSync(OUT, { recursive: true })

// A square tile is just the icon resized. Using the "max" variant so it
// fills edge-to-edge and never shows the default placeholder.
async function squareTile(size, name) {
    await sharp(ICON_FULL)
        .resize(size, size, { fit: 'contain', background: BG })
        .png()
        .toFile(path.join(OUT, name))
    console.log(`  ✓ ${name}  (${size}×${size})`)
}

// A wide/splash tile needs the padded icon centered on a solid blue canvas
// because the square icon cannot be stretched to non-square dimensions.
async function wideTile(width, height, iconHeightRatio, name) {
    const iconSize = Math.round(height * iconHeightRatio)
    const iconBuf  = await sharp(ICON_PAD)
        .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()

    await sharp({
        create: { width, height, channels: 4, background: BG },
    })
        .composite([{ input: iconBuf, gravity: 'center' }])
        .png()
        .toFile(path.join(OUT, name))
    console.log(`  ✓ ${name}  (${width}×${height})`)
}

async function main() {
    console.log('Generating APPX tile assets →', path.relative(ROOT, OUT))

    // Square tiles — full-bleed icon
    await squareTile(44,  'Square44x44Logo.png')
    await squareTile(71,  'Square71x71Logo.png')
    await squareTile(150, 'Square150x150Logo.png')
    await squareTile(310, 'Square310x310Logo.png')

    // Scale variants for 44×44 (app list high-DPI) — optional but recommended
    await squareTile(88,  'Square44x44Logo.scale-200.png')
    await squareTile(176, 'Square44x44Logo.scale-400.png')

    // Scale variants for 150×150 (medium tile)
    await squareTile(225, 'Square150x150Logo.scale-150.png')
    await squareTile(300, 'Square150x150Logo.scale-200.png')

    // Store logo (shown in Store listing + app list small contexts)
    await squareTile(50,  'StoreLogo.png')
    await squareTile(100, 'StoreLogo.scale-200.png')

    // Wide + splash — padded icon on solid blue
    await wideTile(310, 150, 0.66, 'Wide310x150Logo.png')
    await wideTile(620, 300, 0.66, 'Wide310x150Logo.scale-200.png')
    await wideTile(620, 300, 0.55, 'SplashScreen.png')
    await wideTile(1240, 600, 0.55, 'SplashScreen.scale-200.png')

    console.log('\nDone.')
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
