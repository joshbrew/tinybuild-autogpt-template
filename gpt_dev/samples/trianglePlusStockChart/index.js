import './index.css' //ESBUILD CONVENTION FOR BUNDLING CSS

function initRainbowSinewave() {
    if (document.getElementById('rainbow-sinewave-canvas')) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'rainbow-sinewave-canvas';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const pastelStops = [
        {stop:0.00, color:'#FFD1DC'},
        {stop:0.13, color:'#B5EAD7'},
        {stop:0.25, color:'#FFFACD'},
        {stop:0.38, color:'#C7CEEA'},
        {stop:0.50, color:'#FFB7B2'},
        {stop:0.62, color:'#E2F0CB'},
        {stop:0.74, color:'#FDFFB6'},
        {stop:0.87, color:'#A8D8EA'},
        {stop:1.00, color:'#FFDAC1'}
    ];
    function resize() {
        const s = Math.min(window.innerWidth, window.innerHeight)*0.8;
        canvas.width = s;
        canvas.height = s;
    }
    window.addEventListener('resize', resize);
    resize();
    function drawCanvasBg() {
        let grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
        pastelStops.forEach(({stop, color}) => grad.addColorStop(stop, color));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, canvas.height);
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(canvas.width / 2, 0);
        ctx.closePath();
        ctx.clip();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
        ctx.restore();
    }
    function drawRainbowWave(t) {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, canvas.height);
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(canvas.width/2, 0);
        ctx.closePath();
        ctx.clip();
        drawCanvasBg();
        const LAYERS = 8;
        const BASE_A = 60;
        const BASE_FREQ = 2 * Math.PI / canvas.width * 3;
        const baseY = canvas.height * 0.6;
        for (let l = 0; l < LAYERS; l++) {
            let progress = l / (LAYERS-1);
            ctx.beginPath();
            for(let x = 0; x <= canvas.width; x += 1.5){
                let swirl = Math.sin(t*0.0012 + l*2 + x*0.012 + Math.cos(t*0.0006 + x*0.02 + l*9.2))*22*progress;
                let freqMod = Math.sin(t*0.0004 + l*2)*0.17 + 1.1;
                let superWobble = Math.cos(l*3.7 + x*0.011+t*0.0012) * (35 * (progress));
                let offset = Math.sin(t*0.002 + l*8 + x*0.017)*28;
                let y = baseY + (BASE_A+18*Math.sin(l*2.88 + t*0.0017)) *
                    Math.sin(BASE_FREQ * freqMod * x + t*0.0016 + l*1.32)
                    + swirl + offset + superWobble;
                if(x===0) ctx.moveTo(x,y);
                else ctx.lineTo(x,y);
            }
            let grad = ctx.createLinearGradient(0,0,canvas.width,0);
            let shift = (Math.sin(t*0.0005+l*4.11)+1)/2 * 0.3;
            pastelStops.forEach(({stop,color}) => {
                let slide = (stop + shift)%1;
                grad.addColorStop(slide, color);
            });
            ctx.strokeStyle = grad;
            ctx.lineWidth = 8-(6*progress);
            ctx.globalAlpha = 0.33 + 0.39 * (1-Math.abs(progress-0.4));
            ctx.shadowColor = 'rgba(180,145,210,0.16)';
            ctx.shadowBlur = 24-(18*progress);
            ctx.stroke();
        }
        ctx.globalAlpha=1;
        ctx.shadowBlur=0;
        sparkle(t);
        ctx.restore();
        requestAnimationFrame(drawRainbowWave);
    }
    function sparkle(t) {
        let num = 130;
        for(let i=0;i<num;i++){
            let px = (canvas.width*Math.abs(Math.sin(t*0.00067+i*1.11+t*0.0000013*i)))%canvas.width;
            let py = (canvas.height*Math.abs(Math.cos(t*0.00032+i*2.21-t*0.0000007*i)))%canvas.height;
            ctx.beginPath();
            ctx.arc(px,py,1.35+Math.sin(t*0.002+i)*1.12,0,2*Math.PI);
            let alpha = 0.23+0.24*Math.abs(Math.sin(i*1.97+t*0.0022 + px*0.01 ));
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#fff7ef';
            ctx.fill();
        }
        ctx.shadowBlur=0;
    }
    requestAnimationFrame(drawRainbowWave);
}

function initCornerCssCircles() {
    if (document.querySelector('.gradient-circle')) return;
    // Create four corners
    const corners = [
      { cls: 'top-left',    style: { top: '16px', left: '16px' } },
      { cls: 'top-right',   style: { top: '16px', right: '16px' } },
      { cls: 'bottom-left', style: { bottom: '16px', left: '16px' } },
      { cls: 'bottom-right',style: { bottom: '16px', right: '16px' }}
    ];
    corners.forEach((corner, i) => {
      const div = document.createElement('div');
      div.className = 'gradient-circle ' + corner.cls;
      Object.assign(div.style, {
        position: 'fixed',
        zIndex: 40,
        pointerEvents: 'none',
        ...corner.style
      });
      div.setAttribute('data-grow','false');
      document.body.appendChild(div);
    });
    function animateGrowShrink() {
      document.querySelectorAll('.gradient-circle').forEach((el,i) => {
        if (!(el._animTimer)) {
          el._scale = 1;
          el._direction = 1;
        }
        if (Math.random() < 0.006) el._direction = -el._direction;
        el._scale += el._direction * (0.01 + Math.random()*0.008);
        if (el._scale > 1.32) { el._scale = 1.32; el._direction = -1 }
        if (el._scale < 0.78) { el._scale = 0.78; el._direction = 1 }
        el.style.transform = 'scale('+el._scale+')';
      });
      requestAnimationFrame(animateGrowShrink);
    }
    animateGrowShrink();
}

// ----- NVDA STOCK CHART OVERLAY (TradingView Widget fallback) -----
function addNvidiaStockChartOverlay() {
  if (document.getElementById('nvidia-widget-container')) return;
  const container = document.createElement('div');
  container.id = 'nvidia-widget-container';
  Object.assign(container.style, {
    zIndex:4,
    position: 'fixed', top: '8%', left: '50%', transform: 'translateX(-50%)', zIndex: 150,
    opacity: 0.99,
    // pointerEvents: 'none', // <-- FIXED: removed so iframe is clickable
    width: '680px', height: '300px', display: 'block',
    background: 'rgba(10,23,41,0.18)', borderRadius: '24px',
    boxShadow: '0 3px 32px #008bfb33', border:'1px solid #1c48aa44',
    overflow: 'hidden',
  });
  document.body.appendChild(container);
  // TradingView widget (public, no CORS, no API keys)
  container.innerHTML = `<iframe style="width:100%;height:100%;border:0;filter:drop-shadow(0 8px 70px #111b)" src="https://s.tradingview.com/widgetembed/?symbol=NASDAQ:NVDA&interval=D&hidesidetoolbar=1&hidetoptoolbar=1&hidelegend=1&withdateranges=0&theme=dark&saveimage=0&studies=[]&hideideas=1&symboledit=1&watchlist=&locale=en" allowtransparency="true" frameborder="0" allowfullscreen></iframe>`;
}

if (document.body) {
    initRainbowSinewave();
    initCornerCssCircles();
    addNvidiaStockChartOverlay();
} else {
    window.addEventListener('load', () => {
        initRainbowSinewave();
        initCornerCssCircles();
        addNvidiaStockChartOverlay();
    });
}
