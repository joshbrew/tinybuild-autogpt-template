//IMPORT ALL DEPENDENCIES THROUGH INDEX.JS FOR STREAMLINED BUNDLING
import './index.css' //ESBUILD CONVENTION FOR BUNDLING CSS. ALL CSS WILL COMPILE TO INDEX.CSS (based on current filename)

/**
 * Rainbow Pastel Sinewave Animation
 * Dynamically creates a canvas, draws a smooth animated sinewave composed of pastel rainbow solid colors.
 * Appends to body. Updates in realtime with requestAnimationFrame.
 */

// --- CONFIGURABLE PARAMETERS ---
const WAVE_CONFIG = {
    amplitude: 60,              // Wave height
    frequency: 1.5,             // Wave "tightness"
    speed: 2.0,                 // Animation speed multiplier
    thickness: 20,              // Thickness of the rainbow wave
    rainbowColors: [            // Pastel rainbow palette
        '#FFD1DC', // pastel pink
        '#FFFACD', // pastel yellow
        '#B5EAD7', // pastel green
        '#C7CEEA', // pastel indigo
        '#FFDAC1', // pastel orange
        '#E2F0CB', // pastel mint
        '#FFB7B2'  // pastel coral
    ]
};

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'rainbow-sinewave-canvas';
    document.body.appendChild(canvas);
    
    // Style to cover background and stay behind UI
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '-1';
    canvas.style.pointerEvents = 'none';
    
    const ctx = canvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();
    
    function lerp(a, b, t) {
        return a + (b - a) * t;
    }
    
    // Renders all rainbow stripes
    function drawRainbowSine(timestamp) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // For each color, draw a shifted sinewave stripe
        let baseFreq = WAVE_CONFIG.frequency * Math.PI * 2 / canvas.width;
        let time = timestamp * 0.001 * WAVE_CONFIG.speed;
        
        let centerY = canvas.height / 2;
        let total = WAVE_CONFIG.rainbowColors.length;
        for (let i = 0; i < total; i++) {
            let offset = lerp(-WAVE_CONFIG.thickness * total / 2, WAVE_CONFIG.thickness * total / 2, i / (total - 1));
            ctx.beginPath();
            for (let x = 0; x <= canvas.width; x += 2) {
                let y = centerY + offset + Math.sin(x * baseFreq + time + i) * WAVE_CONFIG.amplitude;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = WAVE_CONFIG.rainbowColors[i];
            ctx.lineWidth = WAVE_CONFIG.thickness;
            ctx.lineCap = 'round';
            ctx.shadowColor = WAVE_CONFIG.rainbowColors[i];
            ctx.shadowBlur = 12;
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        requestAnimationFrame(drawRainbowSine);
    }
    requestAnimationFrame(drawRainbowSine);
});
