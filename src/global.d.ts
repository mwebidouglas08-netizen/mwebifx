// Global type augmentations shared across the app.

interface Window {
    // Runtime public path used to build asset URLs (audio, Blockly media, favicon).
    // Set once at startup in src/main.tsx — see src/public-path history (deleted in 956dcae).
    __webpack_public_path__?: string;
}
