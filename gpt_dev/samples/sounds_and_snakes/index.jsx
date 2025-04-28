import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Howl } from "howler";
import "./index.css";

const chimes = [
  { label: "Classic Chime", src: "/chime.mp3", emoji: "🔔", color: "#47a2fe" },
  { label: "Horse Clip Clop", src: "/horse.mp3", emoji: "🐎", color: "#7cd19f" }
];

function playHowl(src, onEnd) {
  const sound = new Howl({ src: [src], html5: true, volume: 0.8 });
  sound.play();
  sound.once("end", () => onEnd?.());
  return sound;
}

function randomColor() {
  const colors = ["#a076f3","#53e9f9","#a7f397","#ffa08b","#ffd36b","#ff6f91","#53dd6c","#ffd6f7"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function AnimatedBubbles({ count = 18 }) {
  const [shapes] = useState(() => Array.from({ length: count }).map((_, i) => ({
    id: i + Math.random(),
    left: Math.random() * 96 + '%',
    size: Math.random() * 58 + 14,
    color: randomColor(),
    duration: Math.random() * 12 + 12,
    delay: Math.random() * 8
  })));
  return (
    <div style={{ position: "fixed", pointerEvents: "none", inset: 0, zIndex: 0 }}>
      {shapes.map((b) => (
        <div
          key={b.id}
          style={{
            position: "absolute",
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            background: `radial-gradient(circle at 60% 40%,${b.color}bb 62%,#fff0 100%)`,
            opacity: 0.27,
            top: "-80px",
            animation: `bubbleFloat ${b.duration}s ${b.delay}s linear infinite`
          }}
        />
      ))}
      <style>{`
      @keyframes bubbleFloat {
        0% { top: -80px; opacity: 0.27; }
        50% { opacity: 0.38; }
        100% { top: 112%; opacity: 0.12; }
      }
      `}</style>
    </div>
  );
}

function useSnakeRandomWalk(length = 15, cellSize = 40) {
  const [path, setPath] = useState([]);
  useEffect(() => {
    let currentPath = [];
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cols = Math.floor(width / cellSize);
    const rows = Math.floor(height / cellSize);

    let x = Math.floor(cols / 2);
    let y = Math.floor(rows / 2);

    currentPath.push({ x, y, color: randomColor() });

    const interval = setInterval(() => {
      const directions = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
      ];

      // Filter out directions that lead to occupied cells or out of bounds
      const validDirs = directions.filter((dir) => {
        const nx = x + dir.x;
        const ny = y + dir.y;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          return false;
        }
        // Check if cell is in the current path
        return !currentPath.some((pos) => pos.x === nx && pos.y === ny);
      });

      // If no valid directions, stop growth (snake crashes)
      if (validDirs.length === 0) {
        // Restart snake in center with new color
        x = Math.floor(cols / 2);
        y = Math.floor(rows / 2);
        currentPath = [{ x, y, color: randomColor() }];
        setPath([...currentPath]);
        return;
      }

      const dir = validDirs[Math.floor(Math.random() * validDirs.length)];
      x += dir.x;
      y += dir.y;

      currentPath.push({ x, y, color: randomColor() });
      if (currentPath.length > length) {
        currentPath.shift();
      }

      setPath([...currentPath]);
    }, 320);

    return () => clearInterval(interval);
  }, [length, cellSize]);

  return path;
}

function Snake({ length = 15, cellSize = 40 }) {
  const path = useSnakeRandomWalk(length, cellSize);

  return (
    <>
      {path.map((pos, i) => {
        return (
          <div
            key={`${pos.x}-${pos.y}-${i}`}
            style={{
              position: 'fixed',
              left: pos.x * cellSize,
              top: pos.y * cellSize,
              width: cellSize - 8,
              height: cellSize - 8,
              borderRadius: '50%',
              background: pos.color,
              opacity: 0.9,
              filter: 'blur(1.5px)',
              animation: `growShrink 1.8s ease-in-out infinite`,
              animationDelay: `${(i * 0.1).toFixed(1)}s`,
              pointerEvents: 'none',
              zIndex: 1000
            }}
          />
        );
      })}
      <style>{`
      @keyframes growShrink {
        0%, 100% { transform: scale(0.4); opacity: 0.7; }
        50% { transform: scale(1); opacity: 1; }
      }
      `}</style>
    </>
  );
}

function StarBurst({ show }) {
  return show ? (
    <div
      style={{
        pointerEvents: "none",
        position: "absolute",
        left: "50%",
        top: "-60px",
        height: 40,
        width: 200,
        marginLeft: "-100px",
        overflow: "visible",
        display: "flex",
        justifyContent: "space-between",
        zIndex: 3
      }}
    >
      {[...Array(13)].map((_, i) => (
        <div
          key={i}
          style={{
            display: "inline-block",
            width: 13,
            height: 13,
            background: randomColor(),
            borderRadius: "50% 30% 55% 40%",
            transform: `scale(${0.7 + Math.sin(i) * 0.15}) rotate(${i * 27}deg)`,
            opacity: 0.75,
            filter: "blur(0.5px)",
            animation: `zoomPop 1150ms cubic-bezier(.44,2.6,.26,.99) ${i * 0.035 + 0.09}s 1 both`
          }}
        />
      ))}
      <style>{`@keyframes zoomPop { 0%{ opacity:0; transform: scale(.2) rotate(0deg);} 70%{opacity:1;} 100% { opacity: 0; transform:scale(2.1) rotate(74deg);} }`}</style>
    </div>
  ) : null;
}

function App() {
  const [playing, setPlaying] = useState(false);
  const [burst, setBurst] = useState(false);
  const [count, setCount] = useState(0);
  const [tone, setTone] = useState(0);
  const btnRef = useRef(null);

  const colorSweep = () => `radial-gradient(ellipse at 60% 20%, #fff9ce 0, ${chimes[tone].color}40 40%, #eaf8fb 100%)`;

  const handlePlay = () => {
    setPlaying(true);
    setBurst(true);
    setCount((c) => c + 1);
    if (btnRef.current) {
      btnRef.current.animate([
        { transform: "scale(1)" },
        { transform: "scale(1.12)" },
        { transform: "scale(1.0)" }
      ], { duration: 400 });
    }
    playHowl(chimes[tone].src, () => {
      setPlaying(false);
      setTimeout(() => setBurst(false), 700);
    });
  };

  const nextTone = () => setTone((t) => (t + 1) % chimes.length);
  const prevTone = () => setTone((t) => (t + chimes.length - 1) % chimes.length);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 32,
        minHeight: "100vh",
        background: colorSweep(),
        color: "#234",
        transition: "background 1.3s cubic-bezier(.27,.67,.33,1)",
        position: "relative",
        overflow: "hidden",
        zIndex: 0
      }}
    >
      <AnimatedBubbles count={18} />
      <Snake length={20} cellSize={50} />
      <div
        style={{
          background: `rgba(255,255,255,${playing ? 0.96 : 0.985})`,
          maxWidth: 430,
          margin: "60px auto 0",
          borderRadius: 38,
          boxShadow: playing
            ? "0 10px 32px #60aae280, 0 2px 0 #d4e9f0"
            : "0 9px 38px #93b7e29d",
          padding: 42,
          textAlign: "center",
          position: "relative"
        }}
      >
        <StarBurst show={burst} />
        <h1
          style={{
            margin: "0 0 20px",
            fontWeight: 900,
            fontSize: 36,
            color: chimes[tone].color,
            letterSpacing: ".04em"
          }}
        >
          <span style={{ fontSize: 38 }} role="img" aria-label="icon">
            {chimes[tone].emoji}
          </span>{" "}
          Sound Party!
        </h1>
        <div
          style={{
            margin: "0 0 24px",
            fontWeight: 400,
            color: "#466",
            fontSize: 17,
            letterSpacing: ".01em",
            opacity: 0.91
          }}
        >
          🎉 <b>Try a different sound!</b> Use arrows&nbsp;
          <button
            aria-label="previous sound"
            onClick={prevTone}
            disabled={playing || chimes.length < 2}
            style={{
              padding: "2px 10px",
              fontSize: 19,
              marginRight: 7,
              border: "none",
              background: "#fff7",
              borderRadius: 10,
              cursor: playing ? "not-allowed" : "pointer"
            }}
          >
            ⏪
          </button>
          <button
            aria-label="next sound"
            onClick={nextTone}
            disabled={playing || chimes.length < 2}
            style={{
              padding: "2px 10px",
              fontSize: 19,
              border: "none",
              background: "#fff7",
              borderRadius: 10,
              cursor: playing ? "not-allowed" : "pointer"
            }}
          >
            ⏩
          </button>
        </div>
        <button
          ref={btnRef}
          onClick={handlePlay}
          disabled={playing}
          style={{
            fontSize: 25,
            padding: "18px 40px",
            borderRadius: 33,
            border: "none",
            outline: "none",
            background: playing
              ? "#d2f0ee"
              : `linear-gradient(88deg,${chimes[tone].color},#49d6e899 90%)`,
            color: playing ? "#767" : "#fff",
            fontWeight: 900,
            letterSpacing: 1,
            cursor: playing ? "not-allowed" : "pointer",
            boxShadow: playing ? "none" : `0 4px 15px ${chimes[tone].color}60`,
            transition: "background .26s, box-shadow .19s, color .17s",
            outlineOffset: 4,
            zIndex: 1
          }}
        >
          {playing ? "🔊 Playing..." : `▶️ Play ${chimes[tone].label}`}
        </button>
        <div
          style={{
            marginTop: 26,
            color: chimes[tone].color,
            fontSize: 16,
            fontWeight: 700,
            opacity: playing ? 0.7 : 1,
            transition: "opacity .25s"
          }}
        >
          <span>{count === 0 ? "Give it a ring!" : `Played ${count} time${count === 1 ? "" : "s"}`}</span>
        </div>
      </div>
      <footer
        style={{ textAlign: "center", marginTop: 58, color: "#8aa", fontSize: 16 }}
      >
        <small>React/Howler Demo &copy; {new Date().getFullYear()} 🎶</small>
      </footer>
    </div>
  );
}

const container = document.getElementById("root") || (() => {
  const el = document.createElement("div");
  el.id = "root";
  document.body.appendChild(el);
  return el;
})();

createRoot(container).render(<App />);
