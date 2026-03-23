import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const BASE_URL = import.meta.env.BASE_URL;
const MASK_STORAGE_KEY = "house-color-picker-mask";

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s * 100, l * 100];
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const maskDataRef = useRef<ImageData | null>(null);
  const [color, setColor] = useState("#3b82f6");
  const [loaded, setLoaded] = useState(false);
  const [editingMask, setEditingMask] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [brushMode, setBrushMode] = useState<"paint" | "erase">("erase");
  const isPaintingRef = useRef(false);

  // Load images and initialize mask
  useEffect(() => {
    const baseImg = new Image();
    const maskImg = new Image();
    let loadedCount = 0;

    const onLoad = () => {
      loadedCount++;
      if (loadedCount === 2) {
        baseImageRef.current = baseImg;

        // Create offscreen canvas to extract mask data
        const offscreen = document.createElement("canvas");
        offscreen.width = baseImg.naturalWidth;
        offscreen.height = baseImg.naturalHeight;
        const offCtx = offscreen.getContext("2d")!;

        // Try loading saved mask from localStorage
        const saved = localStorage.getItem(MASK_STORAGE_KEY);
        if (saved) {
          const savedImg = new Image();
          savedImg.onload = () => {
            offCtx.drawImage(savedImg, 0, 0, offscreen.width, offscreen.height);
            maskDataRef.current = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
            setLoaded(true);
          };
          savedImg.src = saved;
        } else {
          offCtx.drawImage(maskImg, 0, 0, offscreen.width, offscreen.height);
          maskDataRef.current = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
          setLoaded(true);
        }
      }
    };

    baseImg.onload = onLoad;
    maskImg.onload = onLoad;
    baseImg.src = `${BASE_URL}house-base.jpeg`;
    maskImg.src = `${BASE_URL}house-mask.png`;
  }, []);

  // Save mask to localStorage
  const saveMask = useCallback(() => {
    const maskData = maskDataRef.current;
    if (!maskData) return;
    const offscreen = document.createElement("canvas");
    offscreen.width = maskData.width;
    offscreen.height = maskData.height;
    const ctx = offscreen.getContext("2d")!;
    ctx.putImageData(maskData, 0, 0);
    localStorage.setItem(MASK_STORAGE_KEY, offscreen.toDataURL("image/png"));
  }, []);

  // Render the color-applied image
  const renderColor = useCallback(() => {
    const canvas = canvasRef.current;
    const baseImg = baseImageRef.current;
    const maskData = maskDataRef.current;
    if (!canvas || !baseImg || !maskData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;

    ctx.drawImage(baseImg, 0, 0);
    const baseData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const [targetH, targetS] = hexToHsl(color);
    const base = baseData.data;
    const mask = maskData.data;
    const result = ctx.createImageData(canvas.width, canvas.height);
    const out = result.data;

    for (let i = 0; i < base.length; i += 4) {
      const maskAlpha = mask[i];

      if (maskAlpha < 30) {
        out[i] = base[i];
        out[i + 1] = base[i + 1];
        out[i + 2] = base[i + 2];
        out[i + 3] = 255;
        continue;
      }

      const r = base[i] / 255;
      const g = base[i + 1] / 255;
      const b = base[i + 2] / 255;

      const pMax = Math.max(r, g, b);
      const pMin = Math.min(r, g, b);
      const origL = (pMax + pMin) / 2;

      const h = targetH;
      const s = targetS / 100;
      const l = origL;

      const hslToChannel = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      let nr: number, ng: number, nb: number;
      if (s === 0) {
        nr = ng = nb = l;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        nr = hslToChannel(p, q, h / 360 + 1 / 3);
        ng = hslToChannel(p, q, h / 360);
        nb = hslToChannel(p, q, h / 360 - 1 / 3);
      }

      const blend = Math.min(maskAlpha / 255, 1);
      out[i] = Math.round((nr * blend + r * (1 - blend)) * 255);
      out[i + 1] = Math.round((ng * blend + g * (1 - blend)) * 255);
      out[i + 2] = Math.round((nb * blend + b * (1 - blend)) * 255);
      out[i + 3] = 255;
    }

    ctx.putImageData(result, 0, 0);
  }, [color]);

  // Render the mask editing overlay
  const renderMaskOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const baseImg = baseImageRef.current;
    const maskData = maskDataRef.current;
    if (!canvas || !baseImg || !maskData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;

    // Draw base image dimmed
    ctx.drawImage(baseImg, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw mask as colored overlay
    const overlay = ctx.createImageData(canvas.width, canvas.height);
    const od = overlay.data;
    const md = maskData.data;

    for (let i = 0; i < md.length; i += 4) {
      if (md[i] > 30) {
        od[i] = 50;      // R
        od[i + 1] = 200;  // G
        od[i + 2] = 100;  // B
        od[i + 3] = Math.round(md[i] * 0.5); // semi-transparent
      }
    }

    // Composite the overlay
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.putImageData(overlay, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0);
  }, []);

  // Get canvas-space coordinates from mouse/touch event
  const getCanvasPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  // Paint or erase on the mask
  const brushOnMask = useCallback(
    (x: number, y: number) => {
      const maskData = maskDataRef.current;
      if (!maskData) return;

      const { width, height, data } = maskData;
      const radius = brushSize;
      const value = brushMode === "paint" ? 255 : 0;

      const x0 = Math.max(0, Math.floor(x - radius));
      const x1 = Math.min(width - 1, Math.ceil(x + radius));
      const y0 = Math.max(0, Math.floor(y - radius));
      const y1 = Math.min(height - 1, Math.ceil(y + radius));

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - x;
          const dy = py - y;
          if (dx * dx + dy * dy <= radius * radius) {
            const idx = (py * width + px) * 4;
            data[idx] = value;
            data[idx + 1] = value;
            data[idx + 2] = value;
            data[idx + 3] = 255;
          }
        }
      }
    },
    [brushSize, brushMode]
  );

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!editingMask) return;
      e.preventDefault();
      isPaintingRef.current = true;
      const pos = getCanvasPos(e);
      if (pos) {
        brushOnMask(pos.x, pos.y);
        renderMaskOverlay();
      }
    },
    [editingMask, getCanvasPos, brushOnMask, renderMaskOverlay]
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!editingMask || !isPaintingRef.current) return;
      e.preventDefault();
      const pos = getCanvasPos(e);
      if (pos) {
        brushOnMask(pos.x, pos.y);
        renderMaskOverlay();
      }
    },
    [editingMask, getCanvasPos, brushOnMask, renderMaskOverlay]
  );

  const handlePointerUp = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  // Toggle mask editing
  const toggleMaskEdit = useCallback(() => {
    if (editingMask) {
      // Leaving edit mode — save and re-render color
      saveMask();
      setEditingMask(false);
    } else {
      setEditingMask(true);
    }
  }, [editingMask, saveMask]);

  // Reset mask to original
  const resetMask = useCallback(() => {
    localStorage.removeItem(MASK_STORAGE_KEY);
    const maskImg = new Image();
    maskImg.onload = () => {
      const offscreen = document.createElement("canvas");
      const baseImg = baseImageRef.current!;
      offscreen.width = baseImg.naturalWidth;
      offscreen.height = baseImg.naturalHeight;
      const ctx = offscreen.getContext("2d")!;
      ctx.drawImage(maskImg, 0, 0, offscreen.width, offscreen.height);
      maskDataRef.current = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      renderMaskOverlay();
    };
    maskImg.src = `${BASE_URL}house-mask.png`;
  }, [renderMaskOverlay]);

  // Render when mode or color changes
  useEffect(() => {
    if (!loaded) return;
    if (editingMask) {
      renderMaskOverlay();
    } else {
      renderColor();
    }
  }, [loaded, editingMask, renderColor, renderMaskOverlay]);

  return (
    <div className="app">
      <header className="header">
        <h1>House Color Picker</h1>
        <div className="controls">
          {!editingMask && (
            <>
              <label htmlFor="color-picker">Wall Color</label>
              <input
                id="color-picker"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <span className="color-hex">{color}</span>
            </>
          )}

          {editingMask && (
            <>
              <div className="brush-controls">
                <button
                  className={`mode-btn ${brushMode === "paint" ? "active" : ""}`}
                  onClick={() => setBrushMode("paint")}
                >
                  Paint
                </button>
                <button
                  className={`mode-btn ${brushMode === "erase" ? "active" : ""}`}
                  onClick={() => setBrushMode("erase")}
                >
                  Erase
                </button>
              </div>
              <label htmlFor="brush-size">Brush</label>
              <input
                id="brush-size"
                type="range"
                min="5"
                max="100"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
              />
              <span className="brush-size-label">{brushSize}px</span>
              <button className="reset-btn" onClick={resetMask}>
                Reset
              </button>
            </>
          )}

          <button className="edit-mask-btn" onClick={toggleMaskEdit}>
            {editingMask ? "Done" : "Edit Mask"}
          </button>
        </div>
      </header>
      <main className="canvas-container">
        {!loaded && <p className="loading">Loading images...</p>}
        <canvas
          ref={canvasRef}
          className={`house-canvas ${editingMask ? "editing" : ""}`}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />
        <canvas ref={maskCanvasRef} style={{ display: "none" }} />
      </main>
    </div>
  );
}

export default App;
